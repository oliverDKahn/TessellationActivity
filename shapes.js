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

	/**
	 * Vertices of a `points`-pointed star: alternating outer/inner radius
	 * every (180/points) degrees, `points*2` vertices total. rotationDeg
	 * rotates the first outer point away from due east, same convention as
	 * regularPolygonVertices.
	 */
	function starVertices(points, centerX, centerY, outerRadius, innerRadius, rotationDeg) {
		const rotation = (rotationDeg * Math.PI) / 180;
		const vertices = [];
		for (let i = 0; i < points * 2; i++) {
			const radius = i % 2 === 0 ? outerRadius : innerRadius;
			const angle = rotation + (i * Math.PI) / points;
			vertices.push({ x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) });
		}
		return vertices;
	}

	/** center/outerRadius/innerRadius/rotation define a star; vertices are derived from them. */
	function defineStar(points, center, outerRadius, innerRadius, rotationDeg) {
		return { points, center, outerRadius, innerRadius, rotationDeg, vertices: starVertices(points, center.x, center.y, outerRadius, innerRadius, rotationDeg) };
	}

	/**
	 * Vertices of a rhombus (kite-style: right, bottom, left, top before
	 * rotation) with the given half-diagonal lengths. rotationDeg rotates
	 * the "right" vertex away from due east.
	 */
	function rhombusVertices(centerX, centerY, halfWidth, halfHeight, rotationDeg) {
		const rotation = (rotationDeg * Math.PI) / 180;
		const cos = Math.cos(rotation);
		const sin = Math.sin(rotation);
		const local = [
			{ x: halfWidth, y: 0 },
			{ x: 0, y: halfHeight },
			{ x: -halfWidth, y: 0 },
			{ x: 0, y: -halfHeight },
		];
		return local.map((p) => ({ x: centerX + p.x * cos - p.y * sin, y: centerY + p.x * sin + p.y * cos }));
	}

	/** center/halfWidth/halfHeight/rotation define a rhombus; vertices are derived from them. */
	function defineRhombus(center, halfWidth, halfHeight, rotationDeg) {
		return { center, halfWidth, halfHeight, rotationDeg, vertices: rhombusVertices(center.x, center.y, halfWidth, halfHeight, rotationDeg) };
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
		// The 6-pointed star and rhombus from sixfoldRosetteTwoShapes.svg,
		// re-centered/scaled into this shared coordinate space but with
		// their relative proportions preserved exactly (same edge length on
		// both — they're designed to tile together edge-to-edge).
		star: defineStar(6, { x: 480, y: 360 }, 380, 156.10458965973208, 0),
		rhombus: defineRhombus({ x: 480, y: 360 }, 190.04336706136365, 173.89874570769646, 0),
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
	 * translation, no shear/reflection) mapping a master shape's own anchor
	 * point onto a cell anchored at `cellAnchor`, at the given scale.
	 * `rotated180` rotates it exactly 180 degrees instead of leaving it as-is
	 * — e.g. "down" triangle cells (see hexagonTriangleCells for why that's
	 * exact, not approximate); square cells never need this.
	 */
	function similarityTransform(masterAnchor, scale, cellAnchor, rotated180) {
		const signedScale = rotated180 ? -scale : scale;
		return {
			a: signedScale,
			b: 0,
			c: 0,
			d: signedScale,
			e: cellAnchor.x - signedScale * masterAnchor.x,
			f: cellAnchor.y - signedScale * masterAnchor.y,
		};
	}

	/** Thin wrapper over similarityTransform for hexagonTriangleCells' {up, apex} cells. */
	function similarityTransformForCell(masterApex, scale, cell) {
		return similarityTransform(masterApex, scale, cell.apex, !cell.up);
	}

	/** SVG `transform` attribute value for a {a,b,c,d,e,f} matrix. */
	function svgMatrixString(t) {
		return `matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.e} ${t.f})`;
	}

	/**
	 * The small square cells (all identically oriented — squares tile by
	 * plain translation, no rotation needed) that fill an axis-aligned
	 * square with an n x n grid. Each cell reports its own `center`, which
	 * together with the master square's center is all similarityTransform
	 * needs to place a copy of the master square's artwork onto it.
	 */
	function squareGridCells(square, n) {
		const xs = square.vertices.map((v) => v.x);
		const ys = square.vertices.map((v) => v.y);
		const left = Math.min(...xs);
		const top = Math.min(...ys);
		const side = Math.max(...xs) - left; // assumes an axis-aligned square, like SHAPES.square
		const cellSide = side / n;

		const cells = [];
		for (let row = 0; row < n; row++) {
			for (let col = 0; col < n; col++) {
				cells.push({
					center: {
						x: left + (col + 0.5) * cellSide,
						y: top + (row + 0.5) * cellSide,
					},
				});
			}
		}
		return { cells, cellSide };
	}

	/** Interior grid lines (not the outer boundary) for an n x n subdivision of an axis-aligned square. */
	function squareGridLines(square, n) {
		const xs = square.vertices.map((v) => v.x);
		const ys = square.vertices.map((v) => v.y);
		const left = Math.min(...xs);
		const right = Math.max(...xs);
		const top = Math.min(...ys);
		const bottom = Math.max(...ys);
		const cellSide = (right - left) / n;

		const lines = [];
		for (let i = 1; i < n; i++) {
			const x = left + i * cellSide;
			lines.push({ x1: x, y1: top, x2: x, y2: bottom });
			const y = top + i * cellSide;
			lines.push({ x1: left, y1: y, x2: right, y2: y });
		}
		return lines;
	}

	/**
	 * The small flat-top hexagon cells (all identically oriented — regular
	 * hexagons tile a honeycomb by plain translation, no rotation needed,
	 * same as squares) that fill a honeycomb cluster of `rings` rings around
	 * a center cell, sized so the cluster's own footprint has circumradius
	 * `hexagon.radius` (i.e. matches SHAPES.hexagon's own scale).
	 *
	 * A honeycomb cluster's outer envelope is, as a geometric fact (not a
	 * rendering choice), itself an exact regular hexagon — but rotated 30
	 * degrees from its flat-top cells, i.e. pointy-top. (A flat-top
	 * hexagon's 6 neighbor centers sit at the vertex angles of a pointy-top
	 * hexagon; that's unavoidable, not an artifact of this parametrization.)
	 * `envelopeVertices` is that exact boundary, for drawing/clipping.
	 *
	 * cellCount = 1 + 3*rings*(rings+1) (the centered hexagonal numbers);
	 * cellRadius is derived so cellCount small-hexagon areas exactly equal
	 * the envelope hexagon's area — verified numerically, no gaps/overlaps.
	 */
	function hexagonHoneycombCells(hexagon, rings) {
		const cellCount = 1 + 3 * rings * (rings + 1);
		const cellRadius = hexagon.radius / Math.sqrt(cellCount);

		const cells = [];
		for (let q = -rings; q <= rings; q++) {
			const rMin = Math.max(-rings, -q - rings);
			const rMax = Math.min(rings, -q + rings);
			for (let r = rMin; r <= rMax; r++) {
				const center = {
					x: hexagon.center.x + cellRadius * 1.5 * q,
					y: hexagon.center.y + cellRadius * Math.sqrt(3) * (r + q / 2),
				};
				cells.push({ center, vertices: regularPolygonVertices(6, center.x, center.y, cellRadius, 0) });
			}
		}

		const envelopeVertices = regularPolygonVertices(6, hexagon.center.x, hexagon.center.y, hexagon.radius, 30);
		return { cells, cellRadius, envelopeVertices };
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
		starVertices,
		rhombusVertices,
		hexTriangleGridLineFamily,
		hexagonTriangleCells,
		similarityTransform,
		similarityTransformForCell,
		svgMatrixString,
		squareGridCells,
		squareGridLines,
		hexagonHoneycombCells,
		pointsAttr,
		isPointInPolygon,
		distance,
	};
})();
