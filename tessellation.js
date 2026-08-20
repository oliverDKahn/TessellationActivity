/**
 * Toggleable tessellation preview for the workspace panel (currently wired
 * up on triangle.html only).
 *
 * Renders a big hexagon, tiled by a triangular grid, into the
 * <svg class="tessellation-svg"> in the workspace — built from the same
 * hexagon vertex data in shapes.js used elsewhere, so this preview and the
 * shape canvases can never drift apart. A "Toggle Borders" button
 * shows/hides the grid lines.
 *
 * It also connects to the triangle shape canvas's FreehandCanvas
 * (drawing.js) so whatever the user draws there is mirrored, live, into
 * every small triangle cell of the hexagon — upright cells get an unrotated
 * copy, upside-down cells get an exact 180-degree-rotated copy (see
 * shapes.js's hexagonTriangleCells/similarityTransformForCell). Undo/Clear
 * stay in sync for free, since FreehandCanvas removes each stroke's clones
 * along with the stroke itself.
 */
(function () {
	'use strict';

	const SVG_NS = 'http://www.w3.org/2000/svg';

	const LINE_COLOR = '#ffffff';
	const LINE_WIDTH = 1.5;
	const GRID_ROWS = 4; // rows of small triangles between the hexagon's center and each edge

	/**
	 * Build the hexagon outline + triangular grid + (empty, for now) stroke
	 * target inside `svg`. Returns { linesGroup, strokesTarget, clipId }.
	 */
	function buildHexagonTessellation(svg) {
		const { SHAPES, pointsAttr, hexTriangleGridLineFamily } = window.ShapeGeometry;
		const hexagon = SHAPES.hexagon;
		const points = pointsAttr(hexagon.vertices);

		const clipId = 'tessellation-clip-hexagon';
		const defs = document.createElementNS(SVG_NS, 'defs');
		const clipPath = document.createElementNS(SVG_NS, 'clipPath');
		clipPath.setAttribute('id', clipId);
		const clipPolygon = document.createElementNS(SVG_NS, 'polygon');
		clipPolygon.setAttribute('points', points);
		clipPath.appendChild(clipPolygon);
		defs.appendChild(clipPath);

		const group = document.createElementNS(SVG_NS, 'g');
		group.setAttribute('class', 'tessellation-lines');
		group.setAttribute('clip-path', `url(#${clipId})`);
		group.setAttribute('fill', 'none');
		group.setAttribute('stroke', LINE_COLOR);
		group.setAttribute('stroke-width', String(LINE_WIDTH));

		const outline = document.createElementNS(SVG_NS, 'polygon');
		outline.setAttribute('points', points);
		group.appendChild(outline);

		// Three 60-degree-rotated copies of one line family tile the hexagon
		// with a triangular grid — see hexTriangleGridLineFamily's docs.
		const family = hexTriangleGridLineFamily(hexagon.center, hexagon.radius, GRID_ROWS);
		[0, 60, 120].forEach((angle) => {
			const familyGroup = document.createElementNS(SVG_NS, 'g');
			if (angle !== 0) {
				familyGroup.setAttribute('transform', `rotate(${angle} ${hexagon.center.x} ${hexagon.center.y})`);
			}
			family.forEach((segment) => {
				const line = document.createElementNS(SVG_NS, 'line');
				line.setAttribute('x1', segment.x1);
				line.setAttribute('y1', segment.y1);
				line.setAttribute('x2', segment.x2);
				line.setAttribute('y2', segment.y2);
				familyGroup.appendChild(line);
			});
			group.appendChild(familyGroup);
		});

		// Where propagated stroke clones land. Kept separate from
		// `group` (the grid lines) so the drawing stays visible even when
		// borders are toggled off; clipped to the hexagon as a safety net
		// (the per-cell transforms should already keep every clone inside
		// its own cell, which is inside the hexagon).
		const strokesTarget = document.createElementNS(SVG_NS, 'g');
		strokesTarget.setAttribute('class', 'tessellation-strokes');
		strokesTarget.setAttribute('clip-path', `url(#${clipId})`);

		svg.append(defs, group, strokesTarget);
		return { linesGroup: group, strokesTarget, hexagon };
	}

	/** Compute the per-cell transforms that map the triangle canvas's drawing onto the hexagon grid. */
	function computeCellTransforms(hexagon) {
		const { SHAPES, hexagonTriangleCells, similarityTransformForCell, svgMatrixString, distance } = window.ShapeGeometry;
		const master = SHAPES.triangle;
		const masterApex = master.vertices[0];
		const masterSide = distance(master.vertices[0], master.vertices[1]);

		const { cells, cellSide } = hexagonTriangleCells(hexagon, GRID_ROWS);
		const scale = cellSide / masterSide;

		return cells.map((cell) => svgMatrixString(similarityTransformForCell(masterApex, scale, cell)));
	}

	/** Wire the triangle canvas's FreehandCanvas (if present) to propagate strokes into `strokesTarget`. */
	function connectStrokePropagation(strokesTarget, hexagon) {
		const drawingCanvas = window.ShapeDrawing && window.ShapeDrawing.instance;
		if (!drawingCanvas) return;
		drawingCanvas.setPropagation({ group: strokesTarget, transforms: computeCellTransforms(hexagon) });
	}

	/** Find the workspace tessellation SVG + toggle button and wire everything together. */
	function initTessellationToggle(root) {
		root = root || document;
		const svg = root.querySelector('.tessellation-svg');
		if (!svg) return null;

		const { linesGroup, strokesTarget, hexagon } = buildHexagonTessellation(svg);
		linesGroup.classList.add('is-hidden'); // hidden until the button is first pressed

		const button = root.querySelector('.borders-button');
		if (button) {
			button.addEventListener('click', () => {
				const nowHidden = linesGroup.classList.toggle('is-hidden');
				button.setAttribute('aria-pressed', String(!nowHidden));
			});
		}

		connectStrokePropagation(strokesTarget, hexagon);

		return { linesGroup, strokesTarget };
	}

	window.Tessellation = { initTessellationToggle };

	document.addEventListener('DOMContentLoaded', () => initTessellationToggle());
})();
