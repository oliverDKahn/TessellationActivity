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
 * Which tessellation gets built is decided by the page's own shape canvas
 * (.shape-svg[data-shape]) — see the TESSELLATION_BUILDERS map below. Pages
 * without a matching builder (or without a .tessellation-svg at all) simply
 * get no tessellation preview.
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

	const TESSELLATION_BUILDERS = {
		triangle: buildTriangleTessellation,
		square: buildSquareTessellation,
		hexagon: buildHexagonTessellation,
	};

	/** Find the workspace tessellation SVG + toggle button and wire everything together. */
	function initTessellationToggle(root) {
		root = root || document;
		const svg = root.querySelector('.tessellation-svg');
		if (!svg) return null;

		const shapeSvg = root.querySelector('.shape-svg');
		const shapeName = shapeSvg && shapeSvg.dataset.shape;
		const builder = TESSELLATION_BUILDERS[shapeName];
		if (!builder) return null;

		const { linesGroup, strokesTarget, transforms } = builder(svg);
		linesGroup.classList.add('is-hidden'); // hidden until the button is first pressed

		const button = root.querySelector('.borders-button');
		if (button) {
			button.addEventListener('click', () => {
				const nowHidden = linesGroup.classList.toggle('is-hidden');
				button.setAttribute('aria-pressed', String(!nowHidden));
			});
		}

		const drawingCanvas = window.ShapeDrawing && window.ShapeDrawing.instance;
		if (drawingCanvas) drawingCanvas.setPropagation({ group: strokesTarget, transforms });

		return { linesGroup, strokesTarget };
	}

	window.Tessellation = { initTessellationToggle };

	document.addEventListener('DOMContentLoaded', () => initTessellationToggle());
})();
