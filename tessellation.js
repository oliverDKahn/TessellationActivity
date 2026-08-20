/**
 * Toggleable tessellation preview for the workspace panel (currently wired
 * up on triangle.html, square.html, and hexagon.html).
 *
 * Renders a big tiled region into the <svg class="tessellation-svg"> in the
 * workspace — built from the same shape vertex data in shapes.js used
 * elsewhere, so this preview and the shape canvases can never drift apart.
 * A "Toggle Borders" button shows/hides the grid lines.
 *
 * It also connects to the page's shape canvas FreehandCanvas (drawing.js)
 * so whatever the user draws there is mirrored, live, into every small cell
 * of the tessellation — see shapes.js's similarityTransform for how each
 * cell's copy is placed (translated, scaled, and for triangles' "down"
 * cells, rotated exactly 180 degrees — never mirrored). Undo/Clear stay in
 * sync for free, since FreehandCanvas removes each stroke's clones along
 * with the stroke itself.
 *
 * Which tessellation gets built is decided by the workspace SVG's own
 * data-tessellation attribute — see the TESSELLATION_BUILDERS map below.
 * Pages without a matching builder (or without a .tessellation-svg at all)
 * simply get no tessellation preview. (This used to be inferred from the
 * page's .shape-svg[data-shape], but that breaks once a page can have more
 * than one shape canvas — e.g. sixfoldRosette.html's star + rhombus — so
 * each tessellation now names itself explicitly.)
 */
(function () {
	'use strict';

	const SVG_NS = 'http://www.w3.org/2000/svg';
	const LINE_COLOR = '#ffffff';
	const LINE_WIDTH = 1.5;

	function createSvgEl(tag, attrs) {
		const el = document.createElementNS(SVG_NS, tag);
		if (attrs) {
			Object.keys(attrs).forEach((name) => el.setAttribute(name, attrs[name]));
		}
		return el;
	}

	/** A <clipPath> + matching <polygon> outline for `points`, both using `clipId`. */
	function buildOutlineAndClip(points, clipId) {
		const defs = createSvgEl('defs');
		const clipPath = createSvgEl('clipPath', { id: clipId });
		clipPath.appendChild(createSvgEl('polygon', { points }));
		defs.appendChild(clipPath);

		const outline = createSvgEl('polygon', { points });
		return { defs, outline };
	}

	/** The two groups every tessellation needs: toggleable grid lines, and an (always-visible) stroke target. */
	function buildLayers(clipId) {
		const linesGroup = createSvgEl('g', {
			class: 'tessellation-lines',
			'clip-path': `url(#${clipId})`,
			fill: 'none',
			stroke: LINE_COLOR,
			'stroke-width': String(LINE_WIDTH),
		});
		// Kept separate from `linesGroup` so drawings stay visible even when
		// borders are toggled off; clipped as a safety net (the per-cell
		// transforms should already keep every clone inside its own cell,
		// which is inside the tessellated region).
		const strokesTarget = createSvgEl('g', { class: 'tessellation-strokes', 'clip-path': `url(#${clipId})` });
		return { linesGroup, strokesTarget };
	}

	function appendLines(group, lines) {
		lines.forEach((segment) => {
			group.appendChild(createSvgEl('line', { x1: segment.x1, y1: segment.y1, x2: segment.x2, y2: segment.y2 }));
		});
	}

	const TRIANGLE_HEX_ROWS = 4; // rows of small triangles between the hexagon's center and each edge

	/** Big hexagon tiled by a triangular grid, matching the triangle shape canvas. */
	function buildTriangleTessellation(svg) {
		const G = window.ShapeGeometry;
		const hexagon = G.SHAPES.hexagon;
		const points = G.pointsAttr(hexagon.vertices);
		const clipId = 'tessellation-clip-triangle';

		const { defs, outline } = buildOutlineAndClip(points, clipId);
		const { linesGroup, strokesTarget } = buildLayers(clipId);
		linesGroup.appendChild(outline);

		// Three 60-degree-rotated copies of one line family tile the hexagon
		// with a triangular grid — see hexTriangleGridLineFamily's docs.
		const family = G.hexTriangleGridLineFamily(hexagon.center, hexagon.radius, TRIANGLE_HEX_ROWS);
		[0, 60, 120].forEach((angle) => {
			const familyGroup = createSvgEl('g', angle === 0 ? null : { transform: `rotate(${angle} ${hexagon.center.x} ${hexagon.center.y})` });
			appendLines(familyGroup, family);
			linesGroup.appendChild(familyGroup);
		});

		svg.append(defs, linesGroup, strokesTarget);

		const master = G.SHAPES.triangle;
		const masterApex = master.vertices[0];
		const masterSide = G.distance(master.vertices[0], master.vertices[1]);
		const { cells, cellSide } = G.hexagonTriangleCells(hexagon, TRIANGLE_HEX_ROWS);
		const scale = cellSide / masterSide;
		const transforms = cells.map((cell) => G.svgMatrixString(G.similarityTransformForCell(masterApex, scale, cell)));

		return { linesGroup, strokesTarget, transforms };
	}

	const SQUARE_GRID_SIZE = 6; // cells per side

	/** Big square tiled by a plain n x n grid, matching the square shape canvas. */
	function buildSquareTessellation(svg) {
		const G = window.ShapeGeometry;
		const square = G.SHAPES.square;
		const points = G.pointsAttr(square.vertices);
		const clipId = 'tessellation-clip-square';

		const { defs, outline } = buildOutlineAndClip(points, clipId);
		const { linesGroup, strokesTarget } = buildLayers(clipId);
		linesGroup.appendChild(outline);
		appendLines(linesGroup, G.squareGridLines(square, SQUARE_GRID_SIZE));

		svg.append(defs, linesGroup, strokesTarget);

		const master = G.SHAPES.square;
		const masterCenter = master.center;
		const masterSide = G.distance(master.vertices[0], master.vertices[1]);
		const { cells, cellSide } = G.squareGridCells(square, SQUARE_GRID_SIZE);
		const scale = cellSide / masterSide;
		const transforms = cells.map((cell) => G.svgMatrixString(G.similarityTransform(masterCenter, scale, cell.center, false)));

		return { linesGroup, strokesTarget, transforms };
	}

	const HEX_HONEYCOMB_RINGS = 3; // rings of small hexagons around the center cell (37 cells total)

	/**
	 * Honeycomb of small hexagons, matching the hexagon shape canvas. Unlike
	 * triangles, hexagon cells never need rotating — a honeycomb tiles by
	 * plain translation, same as squares. The one wrinkle: the cluster's own
	 * outer envelope is an exact hexagon, but rotated 30 degrees (pointy-top)
	 * from the flat-top cells inside it — a geometric fact of honeycombs, not
	 * a bug — see hexagonHoneycombCells' docs.
	 */
	function buildHexagonTessellation(svg) {
		const G = window.ShapeGeometry;
		const hexagon = G.SHAPES.hexagon;
		const { cells, cellRadius, envelopeVertices } = G.hexagonHoneycombCells(hexagon, HEX_HONEYCOMB_RINGS);
		const points = G.pointsAttr(envelopeVertices);
		const clipId = 'tessellation-clip-hexagon';

		const { defs, outline } = buildOutlineAndClip(points, clipId);
		const { linesGroup, strokesTarget } = buildLayers(clipId);
		linesGroup.appendChild(outline);

		// The honeycomb pattern is just each small cell's own outline.
		cells.forEach((cell) => {
			linesGroup.appendChild(createSvgEl('polygon', { points: G.pointsAttr(cell.vertices) }));
		});

		svg.append(defs, linesGroup, strokesTarget);

		// A regular hexagon's side length equals its circumradius, so this
		// radius ratio is an exact scale factor (no separate side-length lookup needed).
		const scale = cellRadius / hexagon.radius;
		const transforms = cells.map((cell) => G.svgMatrixString(G.similarityTransform(hexagon.center, scale, cell.center, false)));

		return { linesGroup, strokesTarget, transforms };
	}

	const ROSETTE_PADDING = 40; // svg units of clearance around the assembled tiling
	const ROSETTE_RINGS = 3; // rings of rosettes around the center one — 1 ring = 7 rosettes = 7 stars

	/**
	 * The "six-fold rosette" motif — one star with a rhombus nestled into
	 * each of its 6 valleys — repeated across ROSETTE_RINGS rings of
	 * neighbors (7 rosettes, 7 stars, at ROSETTE_RINGS=1), spaced so
	 * adjacent rosettes' connecting rhombi are shared rather than merely
	 * close — see sixfoldRosetteTiling's docs.
	 *
	 * Unlike the single-shape tessellations, there are two independent
	 * "master shapes" here (the star canvas and the rhombus canvas), each
	 * propagating into its own cells — so this returns `propagationTargets`
	 * (one entry per shape) instead of a single strokesTarget/transforms
	 * pair. Star cells only ever need translating/scaling (never rotating —
	 * see sixfoldRosetteTiling); rhombus cells need whatever rotation each
	 * one took to nestle into its star's valley.
	 *
	 * No per-cell clip-path here (unlike the other tessellations' one big
	 * envelope clip) — with dozens of star copies and hundreds of rhombus
	 * copies at higher ring counts, clipping every one individually isn't
	 * worth it: since every cell is an exact similarity-transformed copy of
	 * its own already-constrained master shape, content mathematically
	 * cannot spill past its own cell's boundary.
	 */
	function buildSixfoldRosetteTessellation(svg) {
		const G = window.ShapeGeometry;
		const star = G.SHAPES.star;
		const rhombus = G.SHAPES.rhombus;
		const tiling = G.sixfoldRosetteTiling(star, rhombus, ROSETTE_RINGS, G.VIEWBOX_WIDTH, G.VIEWBOX_HEIGHT, ROSETTE_PADDING);

		const linesGroup = createSvgEl('g', {
			class: 'tessellation-lines',
			fill: 'none',
			stroke: LINE_COLOR,
			'stroke-width': String(LINE_WIDTH),
		});
		// Separate per-shape, always-visible targets for propagated strokes —
		// kept out of linesGroup so drawings stay visible with borders off.
		const starStrokesTarget = createSvgEl('g', { class: 'tessellation-strokes' });
		const rhombusStrokesTarget = createSvgEl('g', { class: 'tessellation-strokes' });

		const starPoints = G.pointsAttr(star.vertices);
		const rhombusPoints = G.pointsAttr(rhombus.vertices);
		tiling.forEach(({ starTransform, rhombusTransforms }) => {
			const starGroup = createSvgEl('g', { transform: G.svgMatrixString(starTransform) });
			starGroup.appendChild(createSvgEl('polygon', { points: starPoints }));
			linesGroup.appendChild(starGroup);

			rhombusTransforms.forEach((t) => {
				const rhombusGroup = createSvgEl('g', { transform: G.svgMatrixString(t) });
				rhombusGroup.appendChild(createSvgEl('polygon', { points: rhombusPoints }));
				linesGroup.appendChild(rhombusGroup);
			});
		});

		svg.append(linesGroup, starStrokesTarget, rhombusStrokesTarget);

		const starTransforms = tiling.map((t) => G.svgMatrixString(t.starTransform));
		const rhombusTransforms = tiling.flatMap((t) => t.rhombusTransforms.map((rt) => G.svgMatrixString(rt)));

		return {
			linesGroup,
			propagationTargets: [
				{ shapeName: 'star', group: starStrokesTarget, transforms: starTransforms },
				{ shapeName: 'rhombus', group: rhombusStrokesTarget, transforms: rhombusTransforms },
			],
		};
	}

	const THREE_SHAPE_RINGS = 2; // rings of dodecagons around the center one — 19 dodecagons, 54 hexagons, 72 squares
	const THREE_SHAPE_PADDING = 40;

	/**
	 * The "4.6.12" tiling — a dodecagon, hexagon, and square meeting at
	 * every vertex (see threeShapeRingPlacements in shapes.js) — repeated
	 * across THREE_SHAPE_RINGS rings of dodecagons. Structurally identical
	 * to buildSixfoldRosetteTessellation (no per-cell clip-path, since
	 * every cell is an exact similarity-transformed copy of its own
	 * already-constrained master shape) but with three master shapes
	 * instead of two.
	 */
	function buildThreeShapeTessellation(svg) {
		const G = window.ShapeGeometry;
		const dodecagon = G.SHAPES.threeShapeDodecagon;
		const hexagon = G.SHAPES.threeShapeHexagon;
		const square = G.SHAPES.threeShapeSquare;
		const tiling = G.threeShapeTiling(dodecagon, hexagon, square, THREE_SHAPE_RINGS, G.VIEWBOX_WIDTH, G.VIEWBOX_HEIGHT, THREE_SHAPE_PADDING);

		const linesGroup = createSvgEl('g', {
			class: 'tessellation-lines',
			fill: 'none',
			stroke: LINE_COLOR,
			'stroke-width': String(LINE_WIDTH),
		});

		const dodecagonPoints = G.pointsAttr(dodecagon.vertices);
		const hexagonPoints = G.pointsAttr(hexagon.vertices);
		const squarePoints = G.pointsAttr(square.vertices);
		tiling.forEach(({ dodecagonTransform, hexTransforms, squareTransforms }) => {
			const dodecagonGroup = createSvgEl('g', { transform: G.svgMatrixString(dodecagonTransform) });
			dodecagonGroup.appendChild(createSvgEl('polygon', { points: dodecagonPoints }));
			linesGroup.appendChild(dodecagonGroup);

			hexTransforms.forEach((t) => {
				const hexGroup = createSvgEl('g', { transform: G.svgMatrixString(t) });
				hexGroup.appendChild(createSvgEl('polygon', { points: hexagonPoints }));
				linesGroup.appendChild(hexGroup);
			});
			squareTransforms.forEach((t) => {
				const squareGroup = createSvgEl('g', { transform: G.svgMatrixString(t) });
				squareGroup.appendChild(createSvgEl('polygon', { points: squarePoints }));
				linesGroup.appendChild(squareGroup);
			});
		});

		svg.append(linesGroup);

		return { linesGroup };
	}

	const TESSELLATION_BUILDERS = {
		triangle: buildTriangleTessellation,
		square: buildSquareTessellation,
		hexagon: buildHexagonTessellation,
		sixfoldRosette: buildSixfoldRosetteTessellation,
		threeShape: buildThreeShapeTessellation,
	};

	/** Find the workspace tessellation SVG + toggle button and wire everything together. */
	function initTessellationToggle(root) {
		root = root || document;
		const svg = root.querySelector('.tessellation-svg');
		if (!svg) return null;

		const builder = TESSELLATION_BUILDERS[svg.dataset.tessellation];
		if (!builder) return null;

		const { linesGroup, strokesTarget, transforms, propagationTargets } = builder(svg);
		linesGroup.classList.add('is-hidden'); // hidden until the button is first pressed

		const button = root.querySelector('.borders-button');
		if (button) {
			button.addEventListener('click', () => {
				const nowHidden = linesGroup.classList.toggle('is-hidden');
				button.setAttribute('aria-pressed', String(!nowHidden));
			});
		}

		// ShapeDrawing.instance is one FreehandCanvas on a single-shape page
		// (triangle/square/hexagon), or an array on a page with several shape
		// canvases (e.g. sixfoldRosette.html's star + rhombus).
		const instance = window.ShapeDrawing && window.ShapeDrawing.instance;
		const canvases = Array.isArray(instance) ? instance : instance ? [instance] : [];

		if (propagationTargets) {
			// Multi-shape page: each target names which canvas's strokes it wants.
			propagationTargets.forEach((target) => {
				const canvas = canvases.find((c) => c.svg.dataset.shape === target.shapeName);
				if (canvas) canvas.setPropagation({ group: target.group, transforms: target.transforms });
			});
		} else if (strokesTarget && transforms && canvases.length === 1) {
			// Single-shape page: the one canvas found is assumed to match.
			canvases[0].setPropagation({ group: strokesTarget, transforms });
		}

		return { linesGroup, strokesTarget };
	}

	window.Tessellation = { initTessellationToggle };

	document.addEventListener('DOMContentLoaded', () => initTessellationToggle());
})();
