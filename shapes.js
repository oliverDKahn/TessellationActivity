/**
 * Shape geometry: the single source of truth for each polygon's vertices.
 *
 * Vertices live in the same 960x720 coordinate space as each shape canvas's
 * SVG viewBox (see triangle/square/hexagon.html). That one array of points
 * per shape drives everything geometric:
 *   - rendering the outline polygon (drawing.js)
 *   - clipping/constraining freehand strokes to inside the shape (drawing.js)
 *   - future features: snapping to grid points, propagating strokes across
 *     the tessellation
 *
 * Keeping this as plain data (not baked into an image) is what makes those
 * later features possible.
 */
(function () {
	'use strict';

	const VIEWBOX_WIDTH = 960;
	const VIEWBOX_HEIGHT = 720;

	/**
	 * Vertices of a regular polygon on a circle of the given radius.
	 * rotationDeg rotates the first vertex away from due east (0deg);
	 * screen y grows downward, so positive angles sweep clockwise.
	 */
	function regularPolygonVertices(sides, centerX, centerY, radius, rotationDeg) {
		const rotation = (rotationDeg * Math.PI) / 180;
		const vertices = [];
		for (let i = 0; i < sides; i++) {
			const angle = rotation + (i * 2 * Math.PI) / sides;
			vertices.push({
				x: centerX + radius * Math.cos(angle),
				y: centerY + radius * Math.sin(angle),
			});
		}
		return vertices;
	}

	/** center/radius/rotation define a shape; vertices are derived from them. */
	function definePolygon(sides, center, radius, rotationDeg) {
		return { sides, center, radius, rotationDeg, vertices: regularPolygonVertices(sides, center.x, center.y, radius, rotationDeg) };
	}

	const SHAPES = {
		// Apex pointing up, flat base — rotation -90 puts the first vertex
		// straight above the center.
		triangle: definePolygon(3, { x: 480, y: 465 }, 420, -90),
		// Rotation 45 turns the circumscribed-vertex square into an
		// axis-aligned one (flat top/bottom/left/right edges).
		square: definePolygon(4, { x: 480, y: 360 }, 424, 45),
		// Rotation 0 gives a flat-top hexagon: flat top/bottom edges,
		// pointed left/right vertices.
		hexagon: definePolygon(6, { x: 480, y: 360 }, 346, 0),
	};

	/**
	 * One family of evenly-spaced horizontal line segments that, together with
	 * two 60-degree-rotated copies of itself, tiles a flat-top regular hexagon
	 * (given its center and circumradius) with a triangular grid: `rows` rows
	 * of unit triangles between the center and each edge (6 * rows^2 small
	 * triangles total). Segments are generous in length and meant to be
	 * clipped to the hexagon afterwards.
	 */
	function hexTriangleGridLineFamily(center, radius, rows) {
		const rowHeight = (radius / rows) * (Math.sqrt(3) / 2);
		const halfLength = radius * 2;
		const lines = [];
		for (let k = -rows; k <= rows; k++) {
			const y = center.y + k * rowHeight;
			lines.push({ x1: center.x - halfLength, y1: y, x2: center.x + halfLength, y2: y });
		}
		return lines;
	}

	/** "x1,y1 x2,y2 ..." string for an SVG polygon/clipPath points attribute. */
	function pointsAttr(vertices) {
		return vertices.map((p) => `${p.x},${p.y}`).join(' ');
	}

	function distance(a, b) {
		return Math.hypot(b.x - a.x, b.y - a.y);
	}

	function centroidOf(vertices) {
		const sum = vertices.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
		return { x: sum.x / vertices.length, y: sum.y / vertices.length };
	}

	/**
	 * Every small triangle cell (both orientations) that tiles a flat-top
	 * regular hexagon with a triangular grid of `rows` rows between the
	 * center and each edge — the same tessellation hexTriangleGridLineFamily
	 * draws as lines, but enumerated as actual triangles.
	 *
	 * Cells come in two families, built from a triangular lattice with basis
	 * vectors u=(s,0) and w=(s/2,h):
	 *   - "up" cells (apex pointing up, base at the bottom) — same
	 *     orientation as SHAPES.triangle, vertices [apex, bottomRight, bottomLeft].
	 *   - "down" cells (apex pointing down, base at the top) — related to
	 *     "up" cells by an exact 180-degree rotation, not a mirror reflection,
	 *     so a lopsided drawing rotates correctly instead of flipping.
	 *
	 * Each cell reports its `apex` point (the vertex a master triangle's own
	 * apex should map onto) plus `up`, which together are all
	 * similarityTransformForCell needs to place a copy of the master
	 * triangle's artwork onto it.
	 */
	function hexagonTriangleCells(hexagon, rows) {
		const { center, radius, vertices: hexVertices } = hexagon;
		const cellSide = radius / rows;
		const rowHeight = cellSide * (Math.sqrt(3) / 2);

		function lattice(i, j) {
			return { x: center.x + i * cellSide + j * (cellSide / 2), y: center.y + j * rowHeight };
		}

		const cells = [];
		const range = rows * 2; // generous bound; real membership is decided by the polygon test below
		for (let i = -range; i <= range; i++) {
			for (let j = -range; j <= range; j++) {
				const p00 = lattice(i, j);
				const p10 = lattice(i + 1, j);
				const p01 = lattice(i, j + 1);
				const p11 = lattice(i + 1, j + 1);

				const upVertices = [p10, p11, p01]; // apex(top), bottomRight, bottomLeft
				if (isPointInPolygon(centroidOf(upVertices), hexVertices)) {
					cells.push({ up: true, apex: p10, vertices: upVertices });
				}

				const downVertices = [p00, p10, p01]; // topLeft, topRight, apex(bottom)
				if (isPointInPolygon(centroidOf(downVertices), hexVertices)) {
					cells.push({ up: false, apex: p01, vertices: downVertices });
				}
			}
		}
		return { cells, cellSide };
	}

	/**
	 * The similarity transform (uniform scale + 0-or-180-degree rotation +
	 * translation, no shear/reflection) that maps a master triangle's own
	 * apex vertex onto one grid cell, at the given scale. "up" cells use the
	 * master's orientation as-is; "down" cells rotate it 180 degrees — see
	 * hexagonTriangleCells for why that's exact, not approximate.
	 */
	function similarityTransformForCell(masterApex, scale, cell) {
		const signedScale = cell.up ? scale : -scale;
		return {
			a: signedScale,
			b: 0,
			c: 0,
			d: signedScale,
			e: cell.apex.x - signedScale * masterApex.x,
			f: cell.apex.y - signedScale * masterApex.y,
		};
	}

	/** SVG `transform` attribute value for a {a,b,c,d,e,f} matrix. */
	function svgMatrixString(t) {
		return `matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.e} ${t.f})`;
	}

	/** Standard ray-casting point-in-polygon test. */
	function isPointInPolygon(point, vertices) {
		let inside = false;
		for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
			const vi = vertices[i];
			const vj = vertices[j];
			const crosses = vi.y > point.y !== vj.y > point.y;
			if (!crosses) continue;
			const xIntersect = ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x;
			if (point.x < xIntersect) inside = !inside;
		}
		return inside;
	}

	window.ShapeGeometry = {
		VIEWBOX_WIDTH,
		VIEWBOX_HEIGHT,
		SHAPES,
		regularPolygonVertices,
		hexTriangleGridLineFamily,
		hexagonTriangleCells,
		similarityTransformForCell,
		svgMatrixString,
		pointsAttr,
		isPointInPolygon,
		distance,
	};
})();
