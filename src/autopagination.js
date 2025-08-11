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
    isTable,
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
          // Place fit. If due to rounding it still overflows, move it to the next page.
          currentContent.appendChild(fit);
          let movedFitToNewPage = false;
          if (!this._contentFits(currentContent)) {
            currentContent.removeChild(fit);
            currentPage = takeNextPage();
            currentContent = currentPage.querySelector('.page-content');
            currentContent.appendChild(fit);
            movedFitToNewPage = true;
          }
          // Place the rest: if we already moved fit to a new page, try to keep rest with it.
          if (rest) {
            if (movedFitToNewPage) {
              currentContent.appendChild(rest);
            } else {
              currentPage = takeNextPage();
              currentContent = currentPage.querySelector('.page-content');
              currentContent.appendChild(rest);
            }
          }
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
      // Measure used height of actual content relative to the content area's top.
      // This approach captures inter-element margins and ignores container min-height.
      const lastEl = contentEl.lastElementChild;
      if (!lastEl) return 0;
      const contRect = contentEl.getBoundingClientRect();
      const lastRect = lastEl.getBoundingClientRect();
      const used = lastRect.bottom - contRect.top;
      return Math.max(0, Math.round(used));
    }

    _getMeasureRoot() {
      // Create or reuse a hidden measurement container matching .page-content width and styles
      if (!this.__measureRoot) {
        const mr = document.createElement('div');
        mr.style.position = 'absolute';
        mr.style.left = '-10000px';
        mr.style.top = '0';
        mr.style.visibility = 'hidden';
        mr.style.pointerEvents = 'none';
        mr.style.whiteSpace = 'normal';
        mr.style.overflowWrap = 'anywhere';
        mr.style.wordBreak = 'break-word';
        // Typography
        mr.style.fontFamily = this.config.fontFamily || 'Arial, sans-serif';
        mr.style.fontSize = this.config.fontSize || '12pt';
        mr.style.lineHeight = (this.lineHeight || 24) + 'px';
        document.body.appendChild(mr);
        this.__measureRoot = mr;
      }
      // Sync width with current page-content
      const pc = this.container.querySelector('.page .page-content');
      if (pc) {
        const w = pc.clientWidth; // content width in px
        if (w && Math.abs((this.__measureRoot.__w || 0) - w) > 0.5) {
          this.__measureRoot.style.width = w + 'px';
          this.__measureRoot.__w = w;
        }
      }
      // Clear previous content
      this.__measureRoot.innerHTML = '';
      return this.__measureRoot;
    }

    _measureLines(el) {
      const mr = this._getMeasureRoot();
      const tmp = el.cloneNode(true);
      mr.appendChild(tmp);
      const h = mr.scrollHeight;
      return Math.max(1, Math.round(h / this.lineHeight));
    }

    _splitParagraphByHeight(p, maxHeight, minLinesPrev = 2, minLinesNext = 2) {
      // Split paragraph into two <p> elements based on words so that first fits into maxHeight
      const words = splitTextIntoWords(p.textContent);
      if (words.length === 0) return { fit: null, rest: null };

      const mr = this._getMeasureRoot();

      let lo = 1, hi = words.length, best = 0;
      // Measure total lines first
      const totalPara = document.createElement('p');
      totalPara.textContent = words.join('');
      mr.appendChild(totalPara);
      const totalLines = Math.max(1, Math.round(mr.scrollHeight / this.lineHeight));
      mr.innerHTML = '';

      if (totalLines < (minLinesPrev + minLinesNext)) {
        return { fit: null, rest: null };
      }

      // Binary search for maximal word count that fits within maxHeight
      const measurePara = document.createElement('p');
      mr.appendChild(measurePara);
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        measurePara.textContent = words.slice(0, mid).join('');
        const h = mr.scrollHeight;
        const linesUsed = Math.max(1, Math.round(h / this.lineHeight));
        const linesRemain = totalLines - linesUsed;
        if (h <= maxHeight && linesUsed >= minLinesPrev && linesRemain >= minLinesNext) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      mr.innerHTML = '';

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

      // Measure by progressively adding items using the measurement root (matches page-content width/styles)
      const mr = this._getMeasureRoot();
      const measureList = document.createElement(listEl.nodeName);
      mr.appendChild(measureList);

      let countFit = 0;
      for (let i = 0; i < items.length; i++) {
        measureList.appendChild(items[i].cloneNode(true));
        const h = mr.scrollHeight;
        if (h <= maxHeight) {
          countFit = i + 1;
        } else {
          break;
        }
      }
      mr.innerHTML = '';

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

      // Normalize paste and trigger pagination immediately after paste
      this._onPaste = (e) => this._handlePaste(e);
      this.container.addEventListener('paste', this._onPaste);

      // Observe selection changes to emit current page
      document.addEventListener('selectionchange', () => {
        const cp = this._getCurrentPageNumberFromSelection();
        this._emitChange(cp);
      });
    }

    _handlePaste(e) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      // Only process if pasting into our editor container
      if (!this.container.contains(range.startContainer)) return;

      const cd = e.clipboardData || window.clipboardData;
      if (!cd) return;

      let html = cd.getData && cd.getData('text/html');
      let text = cd.getData && cd.getData('text/plain');
      // If nothing to handle, let default happen
      if (!html && !text) return;

      e.preventDefault();

      let normalizedHTML = '';
      if (html && html.trim()) {
        normalizedHTML = this._normalizePastedHTML(html);
      } else {
        const escape = (s) => s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        const lines = (text || '').split(/\r?\n/);
        normalizedHTML = lines.map(line => {
          const t = line.trim();
          return t ? `<p>${escape(t)}</p>` : '<p><br></p>';
        }).join('');
      }

      // Insert normalized HTML at caret
      try {
        range.deleteContents();
        const temp = document.createElement('div');
        temp.innerHTML = normalizedHTML;
        let last = null;
        while (temp.firstChild) {
          last = temp.firstChild;
          range.insertNode(last);
          range.setStartAfter(last);
          range.collapse(true);
        }
        // Restore selection after last inserted node
        const after = document.createRange();
        if (last) {
          after.setStartAfter(last);
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
        }
      } catch (err) {
        console.error('Paste insertion failed', err);
      }

      // Repaginate to apply formatting and page breaks
      this._paginateWithCaretPreserved(true);
    }

    _normalizePastedHTML(html) {
      // Strip external styles and disallowed tags so our editor styles apply
      const div = document.createElement('div');
      try {
        // Use DOMParser if available to get body only
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const body = doc && doc.body ? doc.body : null;
        div.innerHTML = body ? body.innerHTML : html;
      } catch (_) {
        div.innerHTML = html;
      }

      // Remove scripts/styles/meta/link
      div.querySelectorAll('script, style, link, meta').forEach(el => el.remove());
      // Unwrap <font> tags
      div.querySelectorAll('font').forEach(el => {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        el.remove();
      });
      // Remove inline styles, classes, ids to enforce editor formatting
      div.querySelectorAll('*').forEach(el => {
        el.removeAttribute('style');
        el.removeAttribute('class');
        el.removeAttribute('id');
        // Normalize images/tables attributes so CSS controls sizing
        if (el.tagName === 'IMG') {
          el.removeAttribute('width');
          el.removeAttribute('height');
          // Ensure broken imgs don't throw; leave src/alt only
        }
        if (el.tagName === 'TABLE' || el.tagName === 'TD' || el.tagName === 'TH') {
          el.removeAttribute('width');
          el.removeAttribute('height');
          el.removeAttribute('align');
        }
      });

      // Normalize plain text nodes at top-level into paragraphs
      const wrapTextNodesIntoParagraphs = (root) => {
        const nodes = Array.from(root.childNodes);
        const toInsert = [];
        nodes.forEach(node => {
          if (node.nodeType === 3 && node.textContent.trim() !== '') {
            const p = document.createElement('p');
            p.textContent = node.textContent.trim();
            toInsert.push({ old: node, newNode: p });
          }
        });
        toInsert.forEach(({ old, newNode }) => {
          root.insertBefore(newNode, old);
          old.remove();
        });
      };
      wrapTextNodesIntoParagraphs(div);

      return div.innerHTML;
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
