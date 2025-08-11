/* AutoPagination core and editor wrapper */
(function(){
  const {
    mmToPx,
    createPage,
    getWorkAreaHeightPx,
    elementContentHeight,
    isBlock,
    isHeading,
    isParagraph,
    isList,
    isListItem,
    splitTextIntoWords,
    cloneNodeShallow,
    flattenPageContents,
    clearAllPages,
    updatePageNumbers,
    saveCaretAbsoluteOffset,
    restoreCaretAbsoluteOffset,
  } = window.DOMUtils;

  const viewModes = {
    'page-view': {
      className: 'page-view',
    },
    'continuous': {
      className: 'continuous',
    },
    'print-preview': {
      className: 'print-preview',
    }
  };

  class AutoPaginator {
    constructor(container, config) {
      this.container = container;
      this.config = config;
      this.pageHeight = getWorkAreaHeightPx();
      this.lineHeight = typeof config.lineHeight === 'number' ? config.lineHeight : 24;
    }

    ensureAtLeastOnePage() {
      const first = this.container.querySelector('.page');
      if (!first) {
        const { page } = createPage({ marginsPx: this._marginsPx() });
        this.container.appendChild(page);
      }
    }

    _marginsPx() {
      const m = this.config.margins || { top: 25, bottom: 25, left: 30, right: 15 };
      return { top: mmToPx(m.top), bottom: mmToPx(m.bottom), left: mmToPx(m.left), right: mmToPx(m.right) };
    }

    paginate() {
      this.ensureAtLeastOnePage();

      // Flatten blocks
      const blocks = flattenPageContents(this.container);
      blocks.forEach(n => n.parentNode && n.parentNode.removeChild(n));

      // Clear pages except first, prepare first content area
      clearAllPages(this.container);
      let pages = Array.from(this.container.querySelectorAll('.page'));
      let currentPage = pages[0];
      let currentContent = currentPage.querySelector('.page-content');

      const takeNextPage = () => {
        const { page } = createPage({ marginsPx: this._marginsPx() });
        this.container.appendChild(page);
        pages = Array.from(this.container.querySelectorAll('.page'));
        return page;
      };

      const appendBlockOrSplit = (block, nextBlocks) => {
        // Try appending block; if overflow, handle according to rules
        currentContent.appendChild(block);
        if (this._contentFits(currentContent)) return; // fits

        // Overflow handling
        currentContent.removeChild(block);

        if (isHeading(block)) {
          // Do not leave heading at bottom without following text: move heading to new page
          currentPage = takeNextPage();
          currentContent = currentPage.querySelector('.page-content');
          currentContent.appendChild(block);
          return;
        }

        if (isParagraph(block)) {
          // Measure total lines of paragraph
          const totalLines = this._measureLines(block);
          if (totalLines < 4) {
            // move entire paragraph to next page
            currentPage = takeNextPage();
            currentContent = currentPage.querySelector('.page-content');
            currentContent.appendChild(block);
            return;
          }
          // Split paragraph respecting widows/orphans (2 lines min each side)
          const remaining = this.pageHeight - this._contentInnerHeight(currentContent);
          const { fit, rest } = this._splitParagraphByHeight(block, remaining, 2, 2);
          if (!fit) {
            // cannot split, move entire
            currentPage = takeNextPage();
            currentContent = currentPage.querySelector('.page-content');
            currentContent.appendChild(block);
            return;
          }
          currentContent.appendChild(fit);
          // Move rest to next page
          currentPage = takeNextPage();
          currentContent = currentPage.querySelector('.page-content');
          currentContent.appendChild(rest);
          return;
        }

        if (isList(block)) {
          const remaining = this.pageHeight - this._contentInnerHeight(currentContent);
          const { fit, rest } = this._splitListByHeight(block, remaining);
          if (!fit) {
            // Whole list to next page
            currentPage = takeNextPage();
            currentContent = currentPage.querySelector('.page-content');
            currentContent.appendChild(block);
            return;
          }
          currentContent.appendChild(fit);
          currentPage = takeNextPage();
          currentContent = currentPage.querySelector('.page-content');
          if (rest) currentContent.appendChild(rest);
          return;
        }

        // Default: move block to next page
        currentPage = takeNextPage();
        currentContent = currentPage.querySelector('.page-content');
        currentContent.appendChild(block);
      };

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        // Normalize inline text nodes into paragraphs
        if (block.nodeType === 3) {
          const p = document.createElement('p');
          p.textContent = block.textContent;
          appendBlockOrSplit(p, blocks.slice(i+1));
        } else if (isBlock(block)) {
          appendBlockOrSplit(block, blocks.slice(i+1));
        } else {
          // Wrap unknown into div
          const div = document.createElement('div');
          div.appendChild(block);
          appendBlockOrSplit(div, blocks.slice(i+1));
        }
      }

      const totalPages = updatePageNumbers(this.container);
      return totalPages;
    }

    _contentFits(contentEl) {
      return this._contentInnerHeight(contentEl) <= this.pageHeight + 0.5; // tolerance
    }

    _contentInnerHeight(contentEl) {
      // Measure used height of actual content, ignoring container min-height
      const first = contentEl.firstChild;
      const last = contentEl.lastChild;
      if (!first || !last) return 0;
      const range = document.createRange();
      try {
        range.setStartBefore(first);
        range.setEndAfter(last);
      } catch (e) {
        // Fallback: if range fails, use scrollHeight but clamp by min-height
        const cs = window.getComputedStyle(contentEl);
        const minH = parseFloat(cs.minHeight || '0') || 0;
        const sh = contentEl.scrollHeight;
        return Math.max(0, sh - minH);
      }
      const rect = range.getBoundingClientRect();
      return Math.max(0, Math.round(rect.height));
    }

    _measureLines(el) {
      const tmp = el.cloneNode(true);
      tmp.style.visibility = 'hidden';
      tmp.style.position = 'absolute';
      tmp.style.pointerEvents = 'none';
      document.body.appendChild(tmp);
      const h = tmp.scrollHeight;
      document.body.removeChild(tmp);
      return Math.max(1, Math.round(h / this.lineHeight));
    }

    _splitParagraphByHeight(p, maxHeight, minLinesPrev = 2, minLinesNext = 2) {
      // Split paragraph into two <p> elements based on words so that first fits into maxHeight
      const words = splitTextIntoWords(p.textContent);
      if (words.length === 0) return { fit: null, rest: null };

      // Create measuring node
      const measure = document.createElement('p');
      measure.style.visibility = 'hidden';
      measure.style.position = 'absolute';
      measure.style.pointerEvents = 'none';
      measure.style.left = '-10000px';
      document.body.appendChild(measure);

      let lo = 1, hi = words.length, best = 0;
      const totalMeasure = document.createElement('p');
      totalMeasure.style.visibility = 'hidden';
      totalMeasure.style.position = 'absolute';
      totalMeasure.style.pointerEvents = 'none';
      totalMeasure.style.left = '-10000px';
      totalMeasure.textContent = words.join('');
      document.body.appendChild(totalMeasure);
      const totalLines = Math.max(1, Math.round(totalMeasure.scrollHeight / this.lineHeight));
      document.body.removeChild(totalMeasure);

      if (totalLines < (minLinesPrev + minLinesNext)) {
        document.body.removeChild(measure);
        return { fit: null, rest: null };
      }

      // Binary search for maximal word count that fits within maxHeight
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        measure.textContent = words.slice(0, mid).join('');
        const h = measure.scrollHeight;
        const linesUsed = Math.max(1, Math.round(h / this.lineHeight));
        const linesRemain = totalLines - linesUsed;
        if (h <= maxHeight && linesUsed >= minLinesPrev && linesRemain >= minLinesNext) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      document.body.removeChild(measure);

      if (best <= 0 || best >= words.length) {
        return { fit: null, rest: null };
      }

      const fit = document.createElement('p');
      fit.textContent = words.slice(0, best).join('');
      const rest = document.createElement('p');
      rest.textContent = words.slice(best).join('');
      return { fit, rest };
    }

    _splitListByHeight(listEl, maxHeight) {
      const items = Array.from(listEl.children).filter(isListItem);
      if (items.length === 0) return { fit: null, rest: null };

      const listFit = document.createElement(listEl.nodeName);
      const listRest = document.createElement(listEl.nodeName);

      // Measure by progressively adding items
      const measure = document.createElement(listEl.nodeName);
      measure.style.visibility = 'hidden';
      measure.style.position = 'absolute';
      measure.style.pointerEvents = 'none';
      measure.style.left = '-10000px';
      document.body.appendChild(measure);

      let countFit = 0;
      for (let i = 0; i < items.length; i++) {
        measure.appendChild(items[i].cloneNode(true));
        const h = measure.scrollHeight;
        if (h <= maxHeight) {
          countFit = i + 1;
        } else {
          break;
        }
      }
      document.body.removeChild(measure);

      if (countFit === 0) {
        // Move whole list to next page
        return { fit: null, rest: null };
      }
      // Ensure we don't break list after the first item only
      if (countFit === 1 && items.length > 1) {
        return { fit: null, rest: null };
      }

      // Build lists
      for (let i = 0; i < countFit; i++) listFit.appendChild(items[i].cloneNode(true));
      for (let i = countFit; i < items.length; i++) listRest.appendChild(items[i].cloneNode(true));

      // If nothing remains, return only fit
      if (items.length === countFit) return { fit: listFit, rest: null };
      return { fit: listFit, rest: listRest };
    }
  }

  class AutoPaginationEditor {
    constructor(options) {
      this.container = options.container;
      this.config = options;
      this.listeners = { contentChange: [] };
      this.paginator = new AutoPaginator(this.container, this.config);
      this._setupInitialStyles();
      this._bindEvents();
      // Initial pagination
      this._paginateWithCaretPreserved();
    }

    _setupInitialStyles() {
      // Apply base font to container so measuring corresponds
      this.container.style.fontFamily = this.config.fontFamily || 'Arial, sans-serif';
      this.container.style.fontSize = this.config.fontSize || '12pt';
      this.setViewMode('page-view');
    }

    _bindEvents() {
      const inputHandler = () => this._paginateWithCaretPreserved(true);
      this._onInput = rafDebounce(inputHandler, 60);
      this.container.addEventListener('input', this._onInput);

      // Merge pages on deletion is handled by re-paginating after keydown
      this._onKeyDown = (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          // schedule after DOM updates
          setTimeout(() => this._paginateWithCaretPreserved(true), 0);
        }
      };
      this.container.addEventListener('keydown', this._onKeyDown);

      // Observe selection changes to emit current page
      document.addEventListener('selectionchange', () => {
        const cp = this._getCurrentPageNumberFromSelection();
        this._emitChange(cp);
      });
    }

    _getCurrentPageNumberFromSelection() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return 1;
      let node = sel.anchorNode;
      if (node && node.nodeType === 3) node = node.parentNode;
      const page = node ? node.closest && node.closest('.page') : null;
      if (!page) return 1;
      const num = parseInt(page.getAttribute('data-page-number') || '1', 10);
      return isNaN(num) ? 1 : num;
    }

    _paginateWithCaretPreserved(emitAfter = false) {
      const caret = saveCaretAbsoluteOffset(this.container);
      const totalPages = this.paginator.paginate();
      restoreCaretAbsoluteOffset(this.container, caret);
      if (emitAfter) {
        const cp = this._getCurrentPageNumberFromSelection();
        this._emitChange(cp, totalPages);
      }
    }

    _emitChange(currentPage, totalPages) {
      const pagesCount = totalPages || this.container.querySelectorAll('.page').length;
      const event = { currentPage: currentPage || 1, totalPages: pagesCount };
      this.listeners.contentChange.forEach(fn => {
        try { fn(event); } catch (e) { console.error(e); }
      });
    }

    on(name, handler) {
      if (!this.listeners[name]) this.listeners[name] = [];
      this.listeners[name].push(handler);
    }

    off(name, handler) {
      if (!this.listeners[name]) return;
      const i = this.listeners[name].indexOf(handler);
      if (i >= 0) this.listeners[name].splice(i, 1);
    }

    loadContent(html) {
      // Replace content of the first page with provided HTML
      const firstPage = this.container.querySelector('.page') || createPage({ marginsPx: this.paginator._marginsPx() }).page;
      if (!firstPage.parentNode) this.container.appendChild(firstPage);
      const pc = firstPage.querySelector('.page-content');
      pc.innerHTML = html;
      this._paginateWithCaretPreserved(true);
    }

    setViewMode(mode) {
      // Remove previous mode classes
      this.container.classList.remove('page-view', 'continuous', 'print-preview');
      if (viewModes[mode]) {
        this.container.classList.add(viewModes[mode].className);
      } else {
        this.container.classList.add('page-view');
      }
    }

    exportToPDF() {
      window.print();
    }
  }

  window.AutoPaginationEditor = AutoPaginationEditor;
})();
