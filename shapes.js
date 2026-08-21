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
	const PHI = (1 + Math.sqrt(5)) / 2; // golden ratio — see SHAPES.twelveFoldHexagon's derivation

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

	/**
	 * Vertices of the girih "elongated hexagon" (aka "boat") tile from
	 * twelveFoldShapes.svg: 4 edges of `shortEdge`, 2 of shortEdge*PHI, with
	 * a fixed interior-angle sequence of 144, 108, 144, 108, 144, 72 degrees
	 * (sum 720, as any simple hexagon's must) — the long/short edge ratio
	 * isn't a free choice once those angles are fixed: walking the hexagon
	 * as vectors and requiring them to sum to zero (a closed shape) forces
	 * it to be exactly PHI (verified both algebraically and numerically).
	 * The shape has one axis of symmetry, through its single 72-degree
	 * vertex; this places that vertex at the top (screen convention: due
	 * north), centered at (centerX, centerY).
	 */
	function elongatedHexagonVertices(centerX, centerY, shortEdge) {
		const longEdge = shortEdge * PHI;
		const turnsDeg = [36, 72, 36, 72, 36, 108]; // 180 - interior angle, applied cumulatively per vertex
		const edgeLens = [shortEdge, shortEdge, shortEdge, shortEdge, longEdge, longEdge];

		let dir = 0;
		let cur = { x: 0, y: 0 };
		const local = [cur];
		for (let k = 0; k < 6; k++) {
			const rad = (dir * Math.PI) / 180;
			const next = { x: cur.x + edgeLens[k] * Math.cos(rad), y: cur.y + edgeLens[k] * Math.sin(rad) };
			if (k < 5) local.push(next);
			cur = next;
			dir += turnsDeg[(k + 1) % 6];
		}

		// Recenter on the shape's own centroid, then rotate so the
		// 72-degree vertex (index 5) points straight up.
		const centroid = local.reduce((acc, p) => ({ x: acc.x + p.x / 6, y: acc.y + p.y / 6 }), { x: 0, y: 0 });
		const centered = local.map((p) => ({ x: p.x - centroid.x, y: p.y - centroid.y }));
		const currentAngleDeg = (Math.atan2(centered[5].y, centered[5].x) * 180) / Math.PI;
		const rotation = ((-90 - currentAngleDeg) * Math.PI) / 180;
		const cos = Math.cos(rotation);
		const sin = Math.sin(rotation);
		return centered.map((p) => ({ x: centerX + (p.x * cos - p.y * sin), y: centerY + (p.x * sin + p.y * cos) }));
	}

	/** center/shortEdge define an elongated hexagon; vertices are derived from them. */
	function defineElongatedHexagon(center, shortEdge) {
		return { center, shortEdge, vertices: elongatedHexagonVertices(center.x, center.y, shortEdge) };
	}

	/**
	 * Hub-relative vertices of the "spiral tile" used on the Spiral Activity
	 * page (twelveFoldShapes.html) — a hand-placed polygon built in the
	 * spirit of Paul Gailiunas' "versatile" spiral tilings (Bridges 2000,
	 * "Spiral Tilings"), not a pixel-exact reconstruction of his construction
	 * (that would need precisely reverse-engineering a scanned diagram's
	 * geometry, which didn't converge — this is the deliberately approximate
	 * stand-in instead). Vertex 0 is the "hub": the boundary leaves it at
	 * hub-relative angle 0 degrees and returns at 60 degrees, so the hub
	 * angle is exactly 60 degrees and 6 copies rotated around it (see
	 * spiralTilePinwheelPlacements) close a full turn with no gaps, the same
	 * "six tiles fitted around a point" property Gailiunas' versatile has.
	 * Angles increase strictly from 0 to 60 (a polar radius profile, not an
	 * arbitrary polygon), which guarantees the boundary can't self-intersect.
	 * The profile bulges out, dips concave, then bulges out again at
	 * asymmetric angles (not mirrored around the 30-degree midline) — that
	 * asymmetry is what gives copies arranged around the hub a pinwheel/
	 * spiral look rather than a plain mirror-symmetric flower.
	 */
	function spiralTileLocalVertices() {
		const boundary = [
			{ angleDeg: 0, radius: 60 }, // spoke 1 tip
			{ angleDeg: 10, radius: 95 }, // bulge out
			{ angleDeg: 20, radius: 118 }, // outer tip (widest point)
			{ angleDeg: 30, radius: 95 }, // shallow dip (also the arm-growth edge -- see spiralTileArmStep)
			{ angleDeg: 45, radius: 92 }, // bulge back out
			{ angleDeg: 60, radius: 60 }, // spoke 2 tip -- same radius as spoke 1, for hub closure
		];
		const hub = { x: 0, y: 0 };
		return [
			hub,
			...boundary.map((p) => {
				const rad = (p.angleDeg * Math.PI) / 180;
				return { x: p.radius * Math.cos(rad), y: p.radius * Math.sin(rad) };
			}),
		];
	}

	/**
	 * Places spiralTileLocalVertices at world scale/rotation/position:
	 * rotates about the hub, scales, then translates so the shape's own
	 * bounding-box center (not the hub itself, which sits off to one side of
	 * the shape) lands at `centerX,centerY` — keeps the standalone shape
	 * looking balanced on its canvas, same reasoning as
	 * elongatedHexagonVertices' centroid-centering.
	 */
	function spiralTileVertices(centerX, centerY, scale, rotationDeg) {
		const rad = (rotationDeg * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const rotated = spiralTileLocalVertices().map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
		const xs = rotated.map((p) => p.x);
		const ys = rotated.map((p) => p.y);
		const bboxCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
		return rotated.map((p) => ({ x: centerX + (p.x - bboxCenter.x) * scale, y: centerY + (p.y - bboxCenter.y) * scale }));
	}

	/** center/scale/rotation define a spiral tile; vertices are derived from them. */
	function defineSpiralTile(center, scale, rotationDeg) {
		return { center, scale, rotationDeg, vertices: spiralTileVertices(center.x, center.y, scale, rotationDeg) };
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
		// The dodecagon, hexagon, and square from threeShape.svg — the
		// classic "4.6.12" tiling (a square, a hexagon, and a dodecagon
		// meeting at every vertex: 90 + 120 + 150 = 360 degrees exactly).
		// The source art was close to but not exactly regular (edges within
		// a couple percent of each other, angles within ~1.5 degrees of
		// 90/120/150), so these are exact regular polygons sharing one
		// common edge length (~176 units, derived from a 340-radius
		// dodecagon) rather than a direct trace — the small source
		// imprecision would otherwise leave visible gaps/overlaps once
		// these actually tile together.
		threeShapeDodecagon: definePolygon(12, { x: 480, y: 360 }, 340, -75),
		threeShapeHexagon: definePolygon(6, { x: 480, y: 360 }, 175.9969506697141, 0),
		threeShapeSquare: definePolygon(4, { x: 480, y: 360 }, 124.44863728670911, 45),
		// The 5-pointed star, 10-pointed star, and elongated hexagon from
		// twelveFoldShapes.svg — a classic Islamic (girih-family) star
		// pattern: a 10-pointed star surrounded by 5-pointed stars, bridged
		// by elongated hexagons (see the screenshot in this project's
		// history). The source art's point angles measured ~36.5-37 degrees
		// (with some hand-drawn noise) — 36 degrees is the obviously
		// intended exact value here (it's the defining angle of 5/10-fold
		// geometry, 360/10), so these are exact regular stars built to hit
		// a 36-degree point angle precisely, which fully determines each
		// star's inner/outer radius ratio (there's no other free
		// parameter). That in turn fixes the 10-star's edge length to be
		// exactly PHI times the 5-star's (confirmed against the measured
		// source art, which showed the same ~1.6x relationship) — matching
		// twelveFoldHexagon's short/long edge, which is that same PHI
		// relationship for the same underlying reason.
		twelveFoldStar5: defineStar(5, { x: 480, y: 360 }, 152.05262246998575, 58.07893370497856, -90),
		twelveFoldStar10: defineStar(10, { x: 480, y: 360 }, 340, 178.74857812050544, -90),
		twelveFoldHexagon: defineElongatedHexagon({ x: 480, y: 360 }, 178.74857812050544 / PHI),
		// -120 rotation points the hub's 60-degree wedge (bisector at local
		// 30 degrees) straight up on screen; 4.818973751322179 is
		// (960 - 2*80) / (rotated bounding-box width), the larger of the two
		// fit-to-canvas ratios, chosen by that same 80-unit-padding standard
		// as the other single-shape pages.
		spiralTile: defineSpiralTile({ x: 480, y: 360 }, 4.818973751322179, -120),
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
	 * The similarity transform (uniform scale + arbitrary rotation +
	 * translation, no shear/reflection) mapping a master shape's own anchor
	 * point onto a cell anchored at `cellAnchor`, at the given scale and
	 * rotation (degrees). This is the general form; similarityTransform
	 * below is the 0-or-180-degree special case most cells only ever need.
	 */
	function rotatedSimilarityTransform(masterAnchor, scale, rotationDeg, cellAnchor) {
		const rad = (rotationDeg * Math.PI) / 180;
		const a = scale * Math.cos(rad);
		const b = scale * Math.sin(rad);
		const c = -b;
		const d = a;
		return {
			a,
			b,
			c,
			d,
			e: cellAnchor.x - (a * masterAnchor.x + c * masterAnchor.y),
			f: cellAnchor.y - (b * masterAnchor.x + d * masterAnchor.y),
		};
	}

	/** Apply a {a,b,c,d,e,f} matrix to a point. */
	function applyMatrix(t, p) {
		return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
	}

	/**
	 * `rotatedSimilarityTransform` specialized to 0-or-180-degree rotation —
	 * `rotated180` rotates it exactly 180 degrees instead of leaving it as-is
	 * — e.g. "down" triangle cells (see hexagonTriangleCells for why that's
	 * exact, not approximate); square/hexagon cells never need this.
	 */
	function similarityTransform(masterAnchor, scale, cellAnchor, rotated180) {
		return rotatedSimilarityTransform(masterAnchor, scale, rotated180 ? 180 : 0, cellAnchor);
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

	/**
	 * Native-scale rotation + anchor for the 6 rhombi that nestle into one
	 * 6-pointed star's valleys, forming the classic "six-fold rosette"
	 * motif: a rhombus's two edges from its "narrow" vertex (index 1: the
	 * ~95-degree one) exactly match the star's two edges from that valley,
	 * so the rhombus's other two vertices land exactly on the star's
	 * neighboring spike tips.
	 *
	 * (The source art's star and rhombus have matching edge lengths but the
	 * rhombus's own angle is a hair off the star's exact valley angle —
	 * sub-0.5-degree, invisible at render scale — so this rotates by the
	 * angle the star itself demands rather than trusting the rhombus's
	 * angle, keeping the star's silhouette perfect and any seam error too
	 * small to see.)
	 *
	 * Returns { placements, pivotWorld }: placements is one
	 * { rotationDeg, valley } per valley, and pivotWorld is the rhombus's
	 * own "narrow" vertex (in its native SHAPES.rhombus position) that each
	 * rotation pivots around.
	 */
	function sixfoldRosettePlacements(star, rhombus) {
		const rhombusLocal = rhombus.vertices.map((p) => ({ x: p.x - rhombus.center.x, y: p.y - rhombus.center.y }));
		const pivotWorld = rhombus.vertices[1]; // the rhombus's own "narrow" (~95deg) vertex
		const pivotLocal = rhombusLocal[1];
		const edgeToNeighborLocal = { x: rhombusLocal[2].x - pivotLocal.x, y: rhombusLocal[2].y - pivotLocal.y };

		const placements = [];
		for (let i = 1; i < star.vertices.length; i += 2) {
			const valley = star.vertices[i];
			const spikeBefore = star.vertices[(i - 1 + star.vertices.length) % star.vertices.length];
			const edgeToSpike = { x: spikeBefore.x - valley.x, y: spikeBefore.y - valley.y };
			const rotationDeg =
				(Math.atan2(edgeToSpike.y, edgeToSpike.x) - Math.atan2(edgeToNeighborLocal.y, edgeToNeighborLocal.x)) * (180 / Math.PI);
			placements.push({ rotationDeg, valley });
		}
		return { placements, pivotWorld };
	}

	/**
	 * Native-scale distance between neighboring rosette centers so that
	 * adjacent rosettes' "bridge" rhombi — the one pointing at a neighbor,
	 * and that neighbor's own valley-rhombus pointing back — land exactly
	 * on top of each other. That means each connecting rhombus is
	 * legitimately shared between the two rosettes it touches (each draws
	 * it identically, harmlessly redundant, not just visually adjacent) —
	 * verified numerically to sub-unit precision on ~257-unit edges.
	 */
	function sixfoldRosetteSpacing(star, rhombus) {
		const { placements, pivotWorld } = sixfoldRosettePlacements(star, rhombus);
		const first = placements[0];
		const t = rotatedSimilarityTransform(pivotWorld, 1, first.rotationDeg, first.valley);
		const farTip = applyMatrix(t, rhombus.vertices[3]);
		return distance(star.center, farTip) + distance(star.center, first.valley);
	}

	/**
	 * Center points for a hex-ring cluster: one at `center`, surrounded by
	 * `rings` rings of neighbors, each adjacent pair `spacing` apart
	 * (1 + 3*rings*(rings+1) points total — rings=1 gives 7, "one plus a
	 * ring of six"). For repeating a self-contained motif (e.g. a whole
	 * rosette) across a honeycomb-style layout — unlike
	 * hexagonHoneycombCells, which fits hexagon-shaped CELLS snugly inside
	 * one big hexagon, this just places copies at a given spacing.
	 */
	function hexRingCenters(center, spacing, rings) {
		const cellRadius = spacing / Math.sqrt(3);
		const centers = [];
		for (let q = -rings; q <= rings; q++) {
			const rMin = Math.max(-rings, -q - rings);
			const rMax = Math.min(rings, -q + rings);
			for (let r = rMin; r <= rMax; r++) {
				centers.push({
					x: center.x + cellRadius * 1.5 * q,
					y: center.y + cellRadius * Math.sqrt(3) * (r + q / 2),
				});
			}
		}
		return centers;
	}

	/** Compose an existing transform with a uniform scale then translate: newPoint = scale*t(point) + translate. */
	function composeScaleTranslate(t, scale, translate) {
		return {
			a: t.a * scale,
			b: t.b * scale,
			c: t.c * scale,
			d: t.d * scale,
			e: t.e * scale + translate.x,
			f: t.f * scale + translate.y,
		};
	}

	/**
	 * Tiles `rings` rings of six-fold rosettes (see sixfoldRosettePlacements)
	 * around a center copy, spaced so connecting rhombi are shared between
	 * neighbors (see sixfoldRosetteSpacing) — rings=1 gives 7 copies, "one
	 * plus a ring of six". The whole assembly is then uniformly scaled and
	 * centered to fit within maxWidth x maxHeight (with `padding`
	 * clearance). Returns an array of { starTransform, rhombusTransforms },
	 * one entry per rosette copy — each a matrix mapping that shape's OWN
	 * vertices (as given in SHAPES.star / SHAPES.rhombus) onto its place in
	 * the tiling. The same transforms would place live propagated strokes
	 * there later, exactly like the other tessellations.
	 */
	function sixfoldRosetteTiling(star, rhombus, rings, maxWidth, maxHeight, padding) {
		const { placements, pivotWorld } = sixfoldRosettePlacements(star, rhombus);
		const spacing = sixfoldRosetteSpacing(star, rhombus);
		const centers = hexRingCenters(star.center, spacing, rings);

		// Native-scale (scale=1) transforms for every copy — a plain
		// translation by (copyCenter - star.center) on top of each
		// single-rosette placement — purely to measure the full assembly's
		// bounding box and find the center/scale that fit it to the canvas.
		const nativePerCopy = centers.map((copyCenter) => {
			const delta = { x: copyCenter.x - star.center.x, y: copyCenter.y - star.center.y };
			const starT = { a: 1, b: 0, c: 0, d: 1, e: delta.x, f: delta.y };
			const rhombusTs = placements.map((p) => {
				const t = rotatedSimilarityTransform(pivotWorld, 1, p.rotationDeg, p.valley);
				return { a: t.a, b: t.b, c: t.c, d: t.d, e: t.e + delta.x, f: t.f + delta.y };
			});
			return { starT, rhombusTs };
		});

		const allPoints = nativePerCopy.flatMap(({ starT, rhombusTs }) => [
			...star.vertices.map((v) => applyMatrix(starT, v)),
			...rhombusTs.flatMap((t) => rhombus.vertices.map((v) => applyMatrix(t, v))),
		]);
		const xs = allPoints.map((p) => p.x);
		const ys = allPoints.map((p) => p.y);
		const width = Math.max(...xs) - Math.min(...xs);
		const height = Math.max(...ys) - Math.min(...ys);
		const patternCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
		const scale = Math.min((maxWidth - 2 * padding) / width, (maxHeight - 2 * padding) / height);
		const canvasCenter = { x: maxWidth / 2, y: maxHeight / 2 };
		const translate = { x: canvasCenter.x - scale * patternCenter.x, y: canvasCenter.y - scale * patternCenter.y };

		const tiling = nativePerCopy.map(({ starT, rhombusTs }) => ({
			starTransform: composeScaleTranslate(starT, scale, translate),
			rhombusTransforms: rhombusTs.map((t) => composeScaleTranslate(t, scale, translate)),
		}));
		return dedupeSharedRhombi(tiling, rhombus);
	}

	/**
	 * Every "bridge" rhombus sits in two neighboring rosettes' valleys at
	 * once (see sixfoldRosetteSpacing), so sixfoldRosetteTiling computes it
	 * twice — once from each rosette's own star. Harmless for a static
	 * outline (an identical polygon drawn twice looks the same as once),
	 * but would double a live propagated stroke. This keeps only the first
	 * placement of each physically-coincident rhombus, matched by centroid:
	 * true duplicates land within a unit of each other (the same small
	 * source-art imprecision noted throughout), while genuinely different
	 * neighboring rhombi are tens of units apart — so a small fixed
	 * tolerance cleanly tells them apart.
	 */
	function dedupeSharedRhombi(tiling, rhombus) {
		const DEDUPE_TOLERANCE = 5; // svg units
		const keptCentroids = [];
		return tiling.map(({ starTransform, rhombusTransforms }) => ({
			starTransform,
			rhombusTransforms: rhombusTransforms.filter((t) => {
				const centroid = centroidOf(rhombus.vertices.map((v) => applyMatrix(t, v)));
				const isDuplicate = keptCentroids.some((kept) => distance(kept, centroid) < DEDUPE_TOLERANCE);
				if (isDuplicate) return false;
				keptCentroids.push(centroid);
				return true;
			}),
		}));
	}

	/**
	 * The rigid transform (rotation + translation, scale fixed at 1 — for
	 * shapes already known to share an edge length exactly) mapping a
	 * master shape's own `masterA` -> `worldP` and `masterB` -> `worldQ`.
	 * Used to attach one polygon's edge onto another's: when both polygons
	 * use the same (clockwise, on screen) winding, two shapes sharing an
	 * edge trace it in opposite directions, so the target `worldP`/`worldQ`
	 * pair is the shared edge's endpoints in reverse order.
	 */
	function rigidEdgeTransform(masterA, masterB, worldP, worldQ) {
		const masterVec = { x: masterB.x - masterA.x, y: masterB.y - masterA.y };
		const worldVec = { x: worldQ.x - worldP.x, y: worldQ.y - worldP.y };
		const rotationDeg = (Math.atan2(worldVec.y, worldVec.x) - Math.atan2(masterVec.y, masterVec.x)) * (180 / Math.PI);
		return rotatedSimilarityTransform(masterA, 1, rotationDeg, worldP);
	}

	/**
	 * The "4.6.12" tiling motif (a square, a hexagon, and a dodecagon
	 * meeting at every vertex — 90 + 120 + 150 = 360 degrees exactly) built
	 * from one dodecagon: the 12 shapes (alternating hexagon/square, one
	 * per edge) that nestle directly against its boundary. Each dodecagon
	 * edge borders exactly one neighbor, sharing that edge exactly (see
	 * rigidEdgeTransform) — every third neighbor around the dodecagon
	 * repeats hex/square/hex/square, which is what the 4-6-12 vertex
	 * configuration requires (each dodecagon vertex needs one square and
	 * one hexagon on either side of it).
	 *
	 * Also returns `spacing`, the native-scale distance between this
	 * dodecagon's center and its nearest-neighbor dodecagon's center —
	 * found by attaching a new dodecagon across one hexagon's "far" edge
	 * (the one not shared with this dodecagon; a hexagon borders 3
	 * dodecagons total in this tiling, this one and 2 more). Every
	 * dodecagon in the tiling ends up with the SAME orientation as this
	 * one — a regular dodecagon is unchanged by any 30-degree rotation, and
	 * every attachment in this tiling rotates by an exact multiple of 30
	 * degrees (verified numerically) — so neighboring dodecagons are placed
	 * by plain translation, never rotation; `spacing` and `hexRingCenters`
	 * are all threeShapeTiling needs to lay out as many rings as it likes.
	 */
	function threeShapeRingPlacements(dodecagon, hexagon, square) {
		const neighborPlacements = dodecagon.vertices.map((Pi, i) => {
			const Pi1 = dodecagon.vertices[(i + 1) % dodecagon.vertices.length];
			const isHex = i % 2 === 0;
			const master = isHex ? hexagon : square;
			// Shared edge in reverse: this dodecagon's edge runs Pi -> Pi1, so
			// the neighbor's matching edge runs Pi1 -> Pi (see rigidEdgeTransform).
			const transform = rigidEdgeTransform(master.vertices[0], master.vertices[1], Pi1, Pi);
			return { type: isHex ? 'hex' : 'square', transform };
		});

		const firstHex = neighborPlacements.find((p) => p.type === 'hex');
		const farA = applyMatrix(firstHex.transform, hexagon.vertices[2]);
		const farB = applyMatrix(firstHex.transform, hexagon.vertices[3]);
		const newDodecagon = rigidEdgeTransform(dodecagon.vertices[0], dodecagon.vertices[1], farB, farA);
		const spacing = distance(dodecagon.center, applyMatrix(newDodecagon, dodecagon.center));

		return { neighborPlacements, spacing };
	}

	/**
	 * Tiles `rings` rings of the 4.6.12 motif (see threeShapeRingPlacements)
	 * around a center dodecagon, then uniformly scales and centers the
	 * whole assembly to fit within maxWidth x maxHeight (with `padding`
	 * clearance) — same overall shape as sixfoldRosetteTiling. Returns an
	 * array of { dodecagonTransform, hexTransforms, squareTransforms }, one
	 * entry per dodecagon copy, each transform mapping that shape's OWN
	 * vertices (as given in SHAPES.threeShapeDodecagon /
	 * threeShapeHexagon / threeShapeSquare) onto its place in the tiling.
	 */
	function threeShapeTiling(dodecagon, hexagon, square, rings, maxWidth, maxHeight, padding) {
		const { neighborPlacements, spacing } = threeShapeRingPlacements(dodecagon, hexagon, square);
		const centers = hexRingCenters(dodecagon.center, spacing, rings);

		const nativePerCopy = centers.map((copyCenter) => {
			const delta = { x: copyCenter.x - dodecagon.center.x, y: copyCenter.y - dodecagon.center.y };
			const translateOnly = (t) => ({ a: t.a, b: t.b, c: t.c, d: t.d, e: t.e + delta.x, f: t.f + delta.y });
			return {
				dodecagonTransform: { a: 1, b: 0, c: 0, d: 1, e: delta.x, f: delta.y },
				hexTransforms: neighborPlacements.filter((p) => p.type === 'hex').map((p) => translateOnly(p.transform)),
				squareTransforms: neighborPlacements.filter((p) => p.type === 'square').map((p) => translateOnly(p.transform)),
			};
		});

		const deduped = dedupeThreeShapeNeighbors(nativePerCopy, hexagon, square);

		const allPoints = deduped.flatMap(({ dodecagonTransform, hexTransforms, squareTransforms }) => [
			...dodecagon.vertices.map((v) => applyMatrix(dodecagonTransform, v)),
			...hexTransforms.flatMap((t) => hexagon.vertices.map((v) => applyMatrix(t, v))),
			...squareTransforms.flatMap((t) => square.vertices.map((v) => applyMatrix(t, v))),
		]);
		const xs = allPoints.map((p) => p.x);
		const ys = allPoints.map((p) => p.y);
		const width = Math.max(...xs) - Math.min(...xs);
		const height = Math.max(...ys) - Math.min(...ys);
		const patternCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
		const scale = Math.min((maxWidth - 2 * padding) / width, (maxHeight - 2 * padding) / height);
		const canvasCenter = { x: maxWidth / 2, y: maxHeight / 2 };
		const translate = { x: canvasCenter.x - scale * patternCenter.x, y: canvasCenter.y - scale * patternCenter.y };

		return deduped.map(({ dodecagonTransform, hexTransforms, squareTransforms }) => ({
			dodecagonTransform: composeScaleTranslate(dodecagonTransform, scale, translate),
			hexTransforms: hexTransforms.map((t) => composeScaleTranslate(t, scale, translate)),
			squareTransforms: squareTransforms.map((t) => composeScaleTranslate(t, scale, translate)),
		}));
	}

	/**
	 * Every hexagon borders up to 3 dodecagons and every square up to 2
	 * (see threeShapeRingPlacements), so threeShapeTiling computes shared
	 * ones once per bordering dodecagon copy — harmless for a static
	 * outline, but would double up a future live propagated stroke. Same
	 * centroid-matching approach as dedupeSharedRhombi: true duplicates
	 * land within a unit of each other, genuinely different neighboring
	 * shapes are much farther apart, so a small fixed tolerance separates
	 * them cleanly. Hexagons and squares are deduped independently since
	 * they're never mistakable for each other.
	 */
	function dedupeThreeShapeNeighbors(perDodecagon, hexagon, square) {
		const DEDUPE_TOLERANCE = 5; // svg units
		const keptHexCentroids = [];
		const keptSquareCentroids = [];
		const isNewCentroid = (kept, centroid) => {
			const isDuplicate = kept.some((k) => distance(k, centroid) < DEDUPE_TOLERANCE);
			if (!isDuplicate) kept.push(centroid);
			return !isDuplicate;
		};
		return perDodecagon.map(({ dodecagonTransform, hexTransforms, squareTransforms }) => ({
			dodecagonTransform,
			hexTransforms: hexTransforms.filter((t) => isNewCentroid(keptHexCentroids, centroidOf(hexagon.vertices.map((v) => applyMatrix(t, v))))),
			squareTransforms: squareTransforms.filter((t) => isNewCentroid(keptSquareCentroids, centroidOf(square.vertices.map((v) => applyMatrix(t, v))))),
		}));
	}

	/**
	 * The "twelvefold" girih rosette motif (see the SHAPES comment above
	 * twelveFoldStar5/10/Hexagon) built from one central 10-pointed star:
	 * one elongated hexagon nestled into each of its 10 valleys, and one
	 * 5-pointed star at each of its 10 points.
	 *
	 * Each hexagon nestles by matching its one 72-degree vertex (index 5,
	 * whose two edges are both "long" — see defineElongatedHexagon) to a
	 * valley's 72-degree notch (360 minus the star's 288-degree valley
	 * angle) — both of the star's valley edges have the same length as the
	 * hexagon's long edges, so they match exactly (see rigidEdgeTransform
	 * for the "shared edges run in reverse" rule this relies on).
	 *
	 * Each 5-pointed star's point then exactly fills the wedge left over at
	 * a star-point vertex between the two hexagons nestled in its adjacent
	 * valleys: 36 (10-star point) + 144 (hexagon) + 36 (5-star point) + 144
	 * (hexagon) = 360 degrees exactly — not a coincidence, but the reason
	 * these three shapes' angles/edges were derived the way they were (see
	 * the SHAPES comment). Pinning the 5-star's point (vertex 0) and one
	 * neighbor (vertex 1) onto that shared vertex and the "before" hexagon's
	 * free edge is enough to fully place it (a rigid transform needs only 2
	 * point correspondences) — its other neighbor (vertex 9) then lands
	 * exactly on the "after" hexagon's free edge too, with no further
	 * matching needed (verified numerically to floating-point precision).
	 *
	 * Returns { hexTransforms, starTransforms }, 10 native-scale transforms
	 * each, mapping SHAPES.twelveFoldHexagon / twelveFoldStar5's own
	 * vertices onto their place in the rosette.
	 */
	function twelveFoldRosettePlacements(star10, star5, hexagon) {
		const hexByValley = new Map();
		for (let i = 1; i < star10.vertices.length; i += 2) {
			const next = star10.vertices[(i + 1) % star10.vertices.length];
			hexByValley.set(i, rigidEdgeTransform(hexagon.vertices[4], hexagon.vertices[5], next, star10.vertices[i]));
		}

		const starTransforms = [];
		for (let j = 0; j < star10.vertices.length; j += 2) {
			const valleyBefore = (j - 1 + star10.vertices.length) % star10.vertices.length;
			const hexBeforeFreeEdge = applyMatrix(hexByValley.get(valleyBefore), hexagon.vertices[3]);
			starTransforms.push(rigidEdgeTransform(star5.vertices[0], star5.vertices[1], star10.vertices[j], hexBeforeFreeEdge));
		}

		return { hexTransforms: Array.from(hexByValley.values()), starTransforms };
	}

	/** Rotate a point by `deg` degrees around `aboutCenter`. */
	function rotatePointAround(point, aboutCenter, deg) {
		const rad = (deg * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const dx = point.x - aboutCenter.x;
		const dy = point.y - aboutCenter.y;
		return { x: aboutCenter.x + dx * cos - dy * sin, y: aboutCenter.y + dx * sin + dy * cos };
	}

	/**
	 * Native-scale bounding-circle radius of one full twelvefold rosette
	 * (see twelveFoldRosettePlacements) around its own center — the
	 * farthest any vertex, across the star10, its 10 hexagons, and its 10
	 * five-pointed stars, gets from the star's own center.
	 */
	function twelveFoldRosetteRadius(star10, star5, hexagon) {
		const { hexTransforms, starTransforms } = twelveFoldRosettePlacements(star10, star5, hexagon);
		const allPoints = [
			...star10.vertices,
			...hexTransforms.flatMap((t) => hexagon.vertices.map((v) => applyMatrix(t, v))),
			...starTransforms.flatMap((t) => star5.vertices.map((v) => applyMatrix(t, v))),
		];
		return Math.max(...allPoints.map((p) => distance(p, star10.center)));
	}

	/**
	 * Tiles `rings` rings of complete twelvefold rosettes (see
	 * twelveFoldRosettePlacements) around a center copy — rings=1 gives 7
	 * ("one plus a ring of six"), same convention as sixfoldRosetteTiling.
	 *
	 * Unlike the hexagon-based tessellations, copies here aren't
	 * edge-matched: true 10-fold rotational symmetry can't tile a 2D plane
	 * (the crystallographic restriction theorem allows only 1-, 2-, 3-,
	 * 4-, and 6-fold), so a repeating grid of these rosettes necessarily
	 * leaves gaps between copies — same trade real Islamic 10-fold star
	 * patterns make, usually by filling those gaps with unrelated tiles.
	 * Copies are instead packed as densely as geometrically guaranteed
	 * possible: spaced apart by exactly twice one rosette's own bounding
	 * radius (see twelveFoldRosetteRadius), the minimum center-to-center
	 * distance at which two copies can never overlap (verified numerically
	 * — zero overlapping polygons at any ring count). The ring itself is
	 * rotated 30 degrees from hexRingCenters' own orientation, so the
	 * cluster comes out wider than tall rather than the reverse.
	 *
	 * Then uniformly scales and centers the whole assembly to fit within
	 * maxWidth x maxHeight (with `padding` clearance) — same overall shape
	 * as sixfoldRosetteTiling/threeShapeTiling. Returns an array of {
	 * star10Transform, hexTransforms, starTransforms }, one entry per
	 * rosette copy.
	 */
	function twelveFoldTiling(star10, star5, hexagon, rings, maxWidth, maxHeight, padding) {
		const { hexTransforms, starTransforms } = twelveFoldRosettePlacements(star10, star5, hexagon);
		const spacing = twelveFoldRosetteRadius(star10, star5, hexagon) * 2;
		const centers = hexRingCenters(star10.center, spacing, rings).map((c) => rotatePointAround(c, star10.center, 30));

		const nativePerCopy = centers.map((copyCenter) => {
			const delta = { x: copyCenter.x - star10.center.x, y: copyCenter.y - star10.center.y };
			const translateOnly = (t) => ({ a: t.a, b: t.b, c: t.c, d: t.d, e: t.e + delta.x, f: t.f + delta.y });
			return {
				star10Transform: { a: 1, b: 0, c: 0, d: 1, e: delta.x, f: delta.y },
				hexTransforms: hexTransforms.map(translateOnly),
				starTransforms: starTransforms.map(translateOnly),
			};
		});

		const allPoints = nativePerCopy.flatMap(({ star10Transform, hexTransforms: hts, starTransforms: sts }) => [
			...star10.vertices.map((v) => applyMatrix(star10Transform, v)),
			...hts.flatMap((t) => hexagon.vertices.map((v) => applyMatrix(t, v))),
			...sts.flatMap((t) => star5.vertices.map((v) => applyMatrix(t, v))),
		]);
		const xs = allPoints.map((p) => p.x);
		const ys = allPoints.map((p) => p.y);
		const width = Math.max(...xs) - Math.min(...xs);
		const height = Math.max(...ys) - Math.min(...ys);
		const patternCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
		const scale = Math.min((maxWidth - 2 * padding) / width, (maxHeight - 2 * padding) / height);
		const canvasCenter = { x: maxWidth / 2, y: maxHeight / 2 };
		const translate = { x: canvasCenter.x - scale * patternCenter.x, y: canvasCenter.y - scale * patternCenter.y };

		return nativePerCopy.map(({ star10Transform, hexTransforms: hts, starTransforms: sts }) => ({
			star10Transform: composeScaleTranslate(star10Transform, scale, translate),
			hexTransforms: hts.map((t) => composeScaleTranslate(t, scale, translate)),
			starTransforms: sts.map((t) => composeScaleTranslate(t, scale, translate)),
		}));
	}

	/** Compose two {a,b,c,d,e,f} affine matrices: applying the result equals applying `inner` then `outer`. */
	function composeTransforms(outer, inner) {
		return {
			a: outer.a * inner.a + outer.c * inner.b,
			b: outer.b * inner.a + outer.d * inner.b,
			c: outer.a * inner.c + outer.c * inner.d,
			d: outer.b * inner.c + outer.d * inner.d,
			e: outer.a * inner.e + outer.c * inner.f + outer.e,
			f: outer.b * inner.e + outer.d * inner.f + outer.f,
		};
	}

	/**
	 * The fixed rigid transform (rotation ~19.5 degrees, scale 1) mapping
	 * one spiral tile copy onto the next copy in an outward-growing arm: the
	 * next copy's own hub->B1 edge (vertices 0->1) glued onto the current
	 * copy's B3->B4 edge (vertices 3->4), reversed (see rigidEdgeTransform's
	 * docs for why reversed). Composing this transform with itself is what
	 * spiralTileArmPlacements walks along to grow an arm.
	 *
	 * This specific edge (near the tile's outer tip) was chosen, over the
	 * tile's other 4 outer edges, because repeated chaining along it never
	 * re-enters a neighboring petal's own wedge — verified numerically
	 * across all 5 candidate edges: the other 4 all curl back into an
	 * adjacent arm within 1-3 tiles. B4's exact position (see
	 * spiralTileLocalVertices) was in turn tuned along that same edge to
	 * give this transform a visible ~20-degree curl rather than the near-0
	 * curl (a nearly straight spike, not a spiral) the tile's first-draft B4
	 * gave here.
	 */
	function spiralTileArmStep(tile) {
		return rigidEdgeTransform(tile.vertices[0], tile.vertices[1], tile.vertices[4], tile.vertices[3]);
	}

	/**
	 * Native-scale transforms for a full 6-armed spiral assembly (the Spiral
	 * Activity page's tessellation border): 6 copies of the tile fitted
	 * around its own hub (vertex 0) with no gaps — the hub's 60-degree wedge
	 * angle is exactly what makes 6 copies close a full turn, same idea as
	 * the other rosette placements in this file — each then extended
	 * outward by `generations - 1` further copies chained edge-to-edge via
	 * spiralTileArmStep.
	 *
	 * Because that chaining is a fixed rotation about an off-center pivot
	 * (not a translation), each arm's tiles trace a widening circular arc
	 * that peaks and would eventually curl back in on itself, rather than
	 * growing outward forever the way Gailiunas' actual spiral tilings do —
	 * `generations` needs to stay under that peak (around 10 for this tile,
	 * verified numerically) for every arm to read as growing outward, not
	 * turning back toward the center or overlapping a neighboring arm.
	 */
	function spiralTileArmPlacements(tile, generations) {
		const hub = tile.vertices[0];
		const step = spiralTileArmStep(tile);
		const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

		const placements = [];
		for (let k = 0; k < 6; k++) {
			const petalRotation = rotatedSimilarityTransform(hub, 1, 60 * k, hub);
			let chainStep = identity;
			for (let g = 0; g < generations; g++) {
				placements.push(composeTransforms(petalRotation, chainStep));
				chainStep = composeTransforms(step, chainStep);
			}
		}
		return placements;
	}

	/**
	 * Scales and centers a full spiralTileArmPlacements assembly to fit
	 * within maxWidth x maxHeight (with `padding` clearance) — same overall
	 * shape as the other *Tiling functions in this file. Returns the final
	 * array of transforms, one per tile in the assembly (6 * generations
	 * total), each mapping the tile's OWN vertices onto its place in the
	 * spiral.
	 */
	function spiralTileTiling(tile, generations, maxWidth, maxHeight, padding) {
		const placements = spiralTileArmPlacements(tile, generations);
		const allPoints = placements.flatMap((t) => tile.vertices.map((v) => applyMatrix(t, v)));
		const xs = allPoints.map((p) => p.x);
		const ys = allPoints.map((p) => p.y);
		const width = Math.max(...xs) - Math.min(...xs);
		const height = Math.max(...ys) - Math.min(...ys);
		const patternCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
		const scale = Math.min((maxWidth - 2 * padding) / width, (maxHeight - 2 * padding) / height);
		const canvasCenter = { x: maxWidth / 2, y: maxHeight / 2 };
		const translate = { x: canvasCenter.x - scale * patternCenter.x, y: canvasCenter.y - scale * patternCenter.y };
		return placements.map((t) => composeScaleTranslate(t, scale, translate));
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
		elongatedHexagonVertices,
		hexTriangleGridLineFamily,
		hexagonTriangleCells,
		rotatedSimilarityTransform,
		similarityTransform,
		similarityTransformForCell,
		applyMatrix,
		svgMatrixString,
		squareGridCells,
		squareGridLines,
		hexagonHoneycombCells,
		sixfoldRosettePlacements,
		sixfoldRosetteSpacing,
		hexRingCenters,
		composeScaleTranslate,
		sixfoldRosetteTiling,
		threeShapeRingPlacements,
		threeShapeTiling,
		twelveFoldRosettePlacements,
		twelveFoldRosetteRadius,
		twelveFoldTiling,
		composeTransforms,
		spiralTileArmStep,
		spiralTileArmPlacements,
		spiralTileTiling,
		pointsAttr,
		isPointInPolygon,
		distance,
	};
})();
