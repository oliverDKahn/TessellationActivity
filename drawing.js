/**
 * Freehand stroke drawing for a shape's outline canvas.
 *
 * Each activity page (triangle/square/hexagon) has an <svg class="shape-svg">
 * whose content this module builds entirely at init time, from the vertex
 * data in shapes.js:
 *   - a <polygon class="shape-outline"> for the visible border
 *   - a <clipPath> built from the same vertices
 *   - a <g class="strokes"> (clipped to that path) that stroke paths get
 *     appended into as the user draws
 *
 * It then captures mouse/touch input over the SVG, renders each stroke as
 * an SVG <path> in real time, constrains drawing to inside the shape's
 * polygon, and exposes Undo/Clear. Straying outside the polygon mid-drag
 * doesn't end the stroke — it pauses it, and picks back up as a new
 * subpath (no connecting line across the gap) once the pointer returns,
 * for as long as the pointer stays down.
 *
 * Coordinates are recorded in the SVG's own viewBox space (960x720, see
 * shapes.js), not raw screen pixels. That keeps stroke data
 * resolution-independent, so it stays valid however the canvas is scaled on
 * screen — this is also the coordinate space future features (snapping to
 * grid points, propagating strokes across the tessellation) should work in.
 *
 * Optionally, a canvas can propagate each stroke into other SVGs (e.g. the
 * tessellation preview) via <use> clones — see setPropagation(). Because
 * <use> mirrors its referenced element live, a clone never needs to be
 * manually redrawn: it tracks the master stroke's <path> automatically as
 * the user drags, and disappears with it on undo/clear.
 */
(function () {
	'use strict';

	const SVG_NS = 'http://www.w3.org/2000/svg';

	const OUTLINE_COLOR = '#39bedd';
	const OUTLINE_STROKE_WIDTH = 8;

	const STROKE_COLOR = '#f6f7f9'; // light, visible against the dark night background
	const STROKE_WIDTH = 10;
	const MIN_POINT_SPACING = 2; // svg units; drop points closer together than this

	// Shared across every FreehandCanvas on the page (not a per-instance
	// counter) so stroke <path> ids stay globally unique even with several
	// canvases — e.g. sixfoldRosette.html's star + rhombus. Two elements
	// with the same id is invalid HTML/SVG, and <use href="#id"> resolves
	// ambiguously when it happens: once a second canvas reused an id, its
	// propagated clones (and the first canvas's) could suddenly point at
	// the wrong stroke.
	let nextStrokeId = 1;

	/**
	 * Build a smoothed SVG path "d" string from a list of {x, y} points,
	 * using quadratic curves through segment midpoints. This is the standard
	 * "midpoint smoothing" trick for freehand input: it rounds off the
	 * polyline you'd otherwise get from raw pointer samples.
	 */
	function pointsToPathData(points) {
		if (points.length === 0) return '';
		if (points.length === 1) {
			const p = points[0];
			return `M ${p.x} ${p.y} L ${p.x} ${p.y}`;
		}

		let d = `M ${points[0].x} ${points[0].y}`;
		for (let i = 1; i < points.length - 1; i++) {
			const curr = points[i];
			const next = points[i + 1];
			const midX = (curr.x + next.x) / 2;
			const midY = (curr.y + next.y) / 2;
			d += ` Q ${curr.x} ${curr.y} ${midX} ${midY}`;
		}
		const last = points[points.length - 1];
		d += ` L ${last.x} ${last.y}`;
		return d;
	}

	function createStrokePathElement() {
		const path = document.createElementNS(SVG_NS, 'path');
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke', STROKE_COLOR);
		path.setAttribute('stroke-width', String(STROKE_WIDTH));
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');
		return path;
	}

	/**
	 * Build the outline polygon + clipPath + strokes group inside an empty
	 * <svg>, from the shape's vertex data. Returns the <g> strokes should be
	 * appended into, or null if no geometry was found for this shape.
	 */
	function buildShapeSvg(svg, shapeName) {
		const geometry = window.ShapeGeometry && window.ShapeGeometry.SHAPES[shapeName];
		if (!geometry) return null;

		const { pointsAttr } = window.ShapeGeometry;
		const points = pointsAttr(geometry.vertices);
		const clipId = `shape-clip-${shapeName}`;

		const defs = document.createElementNS(SVG_NS, 'defs');
		const clipPath = document.createElementNS(SVG_NS, 'clipPath');
		clipPath.setAttribute('id', clipId);
		const clipPolygon = document.createElementNS(SVG_NS, 'polygon');
		clipPolygon.setAttribute('points', points);
		clipPath.appendChild(clipPolygon);
		defs.appendChild(clipPath);

		const outline = document.createElementNS(SVG_NS, 'polygon');
		outline.setAttribute('points', points);
		outline.setAttribute('class', 'shape-outline');
		outline.setAttribute('fill', 'none');
		outline.setAttribute('stroke', OUTLINE_COLOR);
		outline.setAttribute('stroke-width', String(OUTLINE_STROKE_WIDTH));
		outline.setAttribute('stroke-linejoin', 'round');
		outline.setAttribute('pointer-events', 'none');

		const strokesGroup = document.createElementNS(SVG_NS, 'g');
		strokesGroup.setAttribute('class', 'strokes');
		// Belt-and-suspenders: input is already constrained to the polygon
		// (see FreehandCanvas), but clipping the rendered strokes too means
		// a curve that bows slightly past the boundary between two
		// near-edge points can never paint outside the shape.
		strokesGroup.setAttribute('clip-path', `url(#${clipId})`);

		svg.append(defs, outline, strokesGroup);
		return strokesGroup;
	}

	/** Manages freehand strokes drawn onto one shape canvas. */
	class FreehandCanvas {
		/**
		 * @param {SVGSVGElement} svg - root SVG; used for pointer capture and coordinate conversion.
		 * @param {SVGGElement} strokesGroup - group new stroke <path>s are appended into.
		 * @param {{x: number, y: number}[]} [polygon] - if given, strokes are constrained to inside this polygon.
		 */
		constructor(svg, strokesGroup, polygon) {
			this.svg = svg;
			this.strokesGroup = strokesGroup;
			this.polygon = polygon || null;
			this.strokes = []; // { segments: [{x, y}][], el: SVGPathElement, cloneGroup: SVGGElement|null }
			this.activeStroke = null;
			this.propagation = null; // { group: SVGGElement, transforms: string[] } — see setPropagation
			this.onCommit = null; // optional callback fired after a stroke is committed — lets a page coordinate Undo across multiple canvases
			this._pendingEntry = false; // pressed outside the shape, waiting for the pointer to enter before drawing starts

			this._onPointerDown = this._onPointerDown.bind(this);
			this._onPointerMove = this._onPointerMove.bind(this);
			this._onPointerEnd = this._onPointerEnd.bind(this);

			this.svg.addEventListener('pointerdown', this._onPointerDown);
			this.svg.addEventListener('pointermove', this._onPointerMove);
			this.svg.addEventListener('pointerup', this._onPointerEnd);
			this.svg.addEventListener('pointercancel', this._onPointerEnd);
		}

		/** Convert a pointer event's screen position into SVG viewBox coordinates. */
		_toCanvasPoint(evt) {
			const ctm = this.svg.getScreenCTM();
			if (!ctm) return { x: 0, y: 0 };
			const pt = this.svg.createSVGPoint();
			pt.x = evt.clientX;
			pt.y = evt.clientY;
			const local = pt.matrixTransform(ctm.inverse());
			return { x: local.x, y: local.y };
			// Extension point: snap {x, y} to the nearest grid vertex here
			// once shape-specific grid points are defined.
		}

		_isInBounds(point) {
			if (!this.polygon) return true;
			return window.ShapeGeometry.isPointInPolygon(point, this.polygon);
		}

		/** Start a new stroke at `point` (already confirmed in-bounds). */
		_beginStroke(point) {
			const el = createStrokePathElement();
			el.id = `freehand-stroke-${nextStrokeId++}`;
			this.strokesGroup.appendChild(el);

			// segments: an array of point-lists. Leaving the shape mid-drag
			// doesn't end the stroke (see _onPointerMove) — it starts a new
			// segment once the pointer comes back inside, so the drawing
			// resumes without a spurious line jumping across the gap.
			this.activeStroke = { segments: [[point]], needsNewSegment: false, el, cloneGroup: this._createPropagationClones(el.id) };
			this._redrawActiveStroke();
		}

		_onPointerDown(evt) {
			if (evt.button !== undefined && evt.button > 0) return; // primary button/touch only

			evt.preventDefault();
			this.svg.setPointerCapture(evt.pointerId);

			const point = this._toCanvasPoint(evt);
			if (this._isInBounds(point)) {
				this._beginStroke(point);
			} else {
				// Press started outside the shape: wait for the pointer to enter
				// (still held down) before drawing anything — see _onPointerMove.
				this._pendingEntry = true;
			}
		}

		_onPointerMove(evt) {
			if (!this.activeStroke && !this._pendingEntry) return;

			const point = this._toCanvasPoint(evt);
			const inBounds = this._isInBounds(point);

			if (!this.activeStroke) {
				// Still waiting for the initial press-outside-then-drag-in entry.
				if (!inBounds) return;
				evt.preventDefault();
				this._pendingEntry = false;
				this._beginStroke(point);
				return;
			}

			if (!inBounds) {
				// Pointer left the shape mid-drag: pause (don't record anything
				// out here) and remember to start a new segment once it's back
				// inside, rather than connecting across the gap with a line.
				this.activeStroke.needsNewSegment = true;
				return;
			}

			evt.preventDefault();

			if (this.activeStroke.needsNewSegment) {
				this.activeStroke.segments.push([point]);
				this.activeStroke.needsNewSegment = false;
				this._redrawActiveStroke();
				return;
			}

			const segment = this.activeStroke.segments[this.activeStroke.segments.length - 1];
			const last = segment[segment.length - 1];
			const dx = point.x - last.x;
			const dy = point.y - last.y;
			if (dx * dx + dy * dy < MIN_POINT_SPACING * MIN_POINT_SPACING) return;

			segment.push(point);
			this._redrawActiveStroke();
		}

		_onPointerEnd() {
			this._pendingEntry = false;
			if (!this.activeStroke) return;

			const totalPoints = this.activeStroke.segments.reduce((sum, segment) => sum + segment.length, 0);
			if (totalPoints < 2) {
				// A stray tap with no drag: nothing worth keeping.
				this.activeStroke.el.remove();
				if (this.activeStroke.cloneGroup) this.activeStroke.cloneGroup.remove();
			} else {
				this.strokes.push(this.activeStroke);
				if (this.onCommit) this.onCommit();
			}
			this.activeStroke = null;
		}

		_redrawActiveStroke() {
			const d = this.activeStroke.segments.map(pointsToPathData).join(' ');
			this.activeStroke.el.setAttribute('d', d);
		}

		/**
		 * Make every future (and any already-drawn) stroke on this canvas also
		 * appear, live, inside another SVG — one <use> per transform, each
		 * pointing at the stroke's <path> by id. `transforms` are SVG
		 * `transform` attribute strings (see shapes.js's svgMatrixString).
		 */
		setPropagation(propagation) {
			this.propagation = propagation;
			this.strokes.forEach((stroke) => {
				if (stroke.cloneGroup) return; // already has clones (propagation set before this stroke existed)
				stroke.cloneGroup = this._createPropagationClones(stroke.el.id);
			});
		}

		/** Build one <use> per propagation transform, referencing `strokeId`, grouped for easy removal. */
		_createPropagationClones(strokeId) {
			if (!this.propagation) return null;
			const { group, transforms } = this.propagation;
			const cloneGroup = document.createElementNS(SVG_NS, 'g');
			transforms.forEach((transform) => {
				const use = document.createElementNS(SVG_NS, 'use');
				use.setAttribute('href', `#${strokeId}`);
				use.setAttribute('transform', transform);
				cloneGroup.appendChild(use);
			});
			group.appendChild(cloneGroup);
			return cloneGroup;
		}

		/** Remove the most recently completed stroke (and its propagated clones, if any). */
		undo() {
			const stroke = this.strokes.pop();
			if (!stroke) return;
			stroke.el.remove();
			if (stroke.cloneGroup) stroke.cloneGroup.remove();
		}

		/** Remove every stroke (and their propagated clones, if any). */
		clear() {
			this.strokes.forEach((stroke) => {
				stroke.el.remove();
				if (stroke.cloneGroup) stroke.cloneGroup.remove();
			});
			this.strokes = [];
		}

		/** Read-only access to recorded strokes (as their segments), e.g. for future propagation logic. */
		getStrokes() {
			return this.strokes.map((stroke) => stroke.segments.map((segment) => segment.slice()));
		}
	}

	/**
	 * Build the shape outline(s) and wire up drawing + toolbar buttons on the
	 * page. Handles one .shape-svg (the common case) or several (e.g. a page
	 * with two stacked canvases) — every canvas found gets its own
	 * FreehandCanvas, but the Undo/Clear buttons are shared: Undo removes
	 * whichever stroke was committed most recently across ALL canvases (via
	 * a chronological log built from each canvas's onCommit), and Clear
	 * wipes every canvas.
	 *
	 * Returns a single FreehandCanvas if there's exactly one .shape-svg (for
	 * backwards compatibility with single-canvas pages), or an array of them
	 * if there are several.
	 */
	function initShapeDrawing(root) {
		root = root || document;
		const svgs = Array.from(root.querySelectorAll('.shape-svg'));
		if (svgs.length === 0) return null;

		const undoLog = []; // chronological list of canvases, one entry per committed stroke, across all of them

		const canvases = svgs
			.map((svg) => {
				const shapeName = svg.dataset.shape;
				const strokesGroup = buildShapeSvg(svg, shapeName);
				if (!strokesGroup) return null;

				const geometry = window.ShapeGeometry.SHAPES[shapeName];
				const canvas = new FreehandCanvas(svg, strokesGroup, geometry.vertices);
				canvas.onCommit = () => undoLog.push(canvas);
				return canvas;
			})
			.filter(Boolean);
		if (canvases.length === 0) return null;

		// Safety net: each canvas's own pointerup/pointercancel listener
		// (backed by setPointerCapture) is supposed to finalize its stroke
		// regardless of where the pointer ends up — but that can fail in
		// practice (releasing outside the browser window, browser-specific
		// capture quirks), leaving a stroke stuck as an unfinished
		// activeStroke: still drawn on screen, but invisible to Undo/Clear,
		// which only look at completed strokes. A new press anywhere, or
		// the window losing focus, means any prior gesture has definitely
		// ended — use either as a cue to finalize defensively.
		function finalizeAnyStuckStrokes() {
			canvases.forEach((canvas) => {
				if (canvas.activeStroke) canvas._onPointerEnd();
			});
		}
		window.addEventListener('pointerdown', finalizeAnyStuckStrokes, true); // capture phase: runs before the new press's own handler
		window.addEventListener('blur', finalizeAnyStuckStrokes);

		const undoButton = root.querySelector('.undo-button');
		const clearButton = root.querySelector('.clear-button');
		if (undoButton) {
			undoButton.addEventListener('click', () => {
				const mostRecent = undoLog.pop();
				if (mostRecent) mostRecent.undo();
			});
		}
		if (clearButton) {
			clearButton.addEventListener('click', () => {
				canvases.forEach((canvas) => canvas.clear());
				undoLog.length = 0;
			});
		}

		// Exposed so other modules (e.g. tessellation.js's propagation hookup)
		// can find these canvases without their own reference. An array when
		// there are several — single-canvas pages keep getting a bare canvas.
		const result = canvases.length === 1 ? canvases[0] : canvases;
		window.ShapeDrawing.instance = result;
		return result;
	}

	window.ShapeDrawing = { FreehandCanvas, initShapeDrawing, instance: null };

	document.addEventListener('DOMContentLoaded', () => initShapeDrawing());
})();
