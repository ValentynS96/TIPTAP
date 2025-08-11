// Utility functions for DOM and measurements
(function(){
  const MM_TO_PX_96DPI = 96 / 25.4; // 1mm in px at 96dpi

  function mmToPx(mm) { return Math.round(mm * MM_TO_PX_96DPI); }

  function createPage({marginsPx}) {
    const page = document.createElement('div');
    page.className = 'page';
    const content = document.createElement('div');
    content.className = 'page-content';
    content.setAttribute('contenteditable', 'true');
    page.appendChild(content);
    // paddings set in CSS; marginsPx may adjust dynamically if needed
    return { page, content };
  }

  function getWorkAreaHeightPx() {
    // Based on CSS: page height 1123, padding t+b = 94+94 = 188; content area approx 935
    return 935; // As per requirements
  }

  function elementContentHeight(el) {
    // Use scrollHeight for content measurement within contenteditable
    return el.scrollHeight; // includes padding of content box; page-content has no extra padding
  }

  function isBlock(node) {
    return node && node.nodeType === 1 && /^(P|H1|H2|H3|H4|UL|OL|DIV|TABLE)$/i.test(node.nodeName);
  }

  function isHeading(node) { return node && node.nodeType === 1 && /^(H1|H2|H3|H4)$/i.test(node.nodeName); }
  function isParagraph(node) { return node && node.nodeType === 1 && node.nodeName === 'P'; }
  function isList(node) { return node && node.nodeType === 1 && /^(UL|OL)$/i.test(node.nodeName); }
  function isListItem(node) { return node && node.nodeType === 1 && node.nodeName === 'LI'; }
  function isTable(node) { return node && node.nodeType === 1 && node.nodeName === 'TABLE'; }

  function splitTextIntoWords(text) {
    // Keep whitespace as separators
    const words = text.split(/(\s+)/).filter(Boolean);
    return words;
  }

  function cloneNodeShallow(node) {
    const clone = node.cloneNode(false); // shallow
    return clone;
  }

  function flattenPageContents(container) {
    const blocks = [];
    const pages = Array.from(container.querySelectorAll('.page .page-content'));

    const collect = (node) => {
      if (!node) return;
      // Text node: push only non-empty
      if (node.nodeType === 3) {
        if (node.textContent.trim() !== '') blocks.push(node);
        return;
      }
      if (node.nodeType !== 1) return;

      const tag = node.nodeName.toUpperCase();
      // Known block-level nodes we can paginate directly
      if (/^(P|H1|H2|H3|H4|UL|OL|TABLE)$/i.test(tag)) {
        blocks.push(node);
        return;
      }
      // Unwrap DIVs by recursively collecting their children (common for pasted content)
      if (tag === 'DIV') {
        Array.from(node.childNodes).forEach(collect);
        return;
      }
      // For any other element, try to collect its children; if none, keep as is
      if (node.childNodes && node.childNodes.length) {
        Array.from(node.childNodes).forEach(collect);
      } else {
        blocks.push(node);
      }
    };

    pages.forEach(pc => Array.from(pc.childNodes).forEach(collect));
    return blocks;
  }

  function clearAllPages(container) {
    const pages = Array.from(container.querySelectorAll('.page'));
    pages.forEach((p, idx) => {
      const pc = p.querySelector('.page-content');
      if (pc) pc.innerHTML = '';
      if (idx > 0) p.remove();
    });
  }

  function updatePageNumbers(container) {
    const pages = Array.from(container.querySelectorAll('.page'));
    pages.forEach((page, index) => {
      page.setAttribute('data-page-number', String(index + 1));
    });
    return pages.length;
  }

  // Caret position helpers across entire document (pages) using absolute character offset
  function getAllTextNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        // Ignore whitespace-only nodes
        return node.textContent.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  const CARET_TOKEN = '\u200B\u200B\u200B';

  function saveCaretAbsoluteOffset(container) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    // Only proceed if selection is within container
    if (!container.contains(range.startContainer)) return null;

    // Insert a unique text token at caret position to reliably track it across repagination
    const markerNode = document.createTextNode(CARET_TOKEN);
    range.insertNode(markerNode);
    // Optional: collapse selection after marker to avoid typing inside token
    const after = document.createRange();
    after.setStartAfter(markerNode);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);

    // Compute absolute offset as a fallback (position before the marker)
    const textNodes = getAllTextNodes(container);
    let offset = 0;
    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i];
      if (tn === markerNode) break;
      offset += tn.textContent.length;
    }
    return { offset };
  }

  function restoreCaretAbsoluteOffset(container, pos) {
    const sel = window.getSelection();
    // First, try to locate the caret token and place caret there
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let nodeWithToken = null;
    while (walker.nextNode()) {
      const tn = walker.currentNode;
      const idx = tn.nodeValue ? tn.nodeValue.indexOf(CARET_TOKEN) : -1;
      if (idx !== -1) {
        nodeWithToken = { tn, idx };
        break;
      }
    }
    if (nodeWithToken) {
      const { tn, idx } = nodeWithToken;
      // Remove the token and place caret at its position
      const before = tn.nodeValue.slice(0, idx);
      const afterText = tn.nodeValue.slice(idx + CARET_TOKEN.length);
      tn.nodeValue = before + afterText;
      const range = document.createRange();
      range.setStart(tn, before.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      // Also clean up any accidental extra tokens elsewhere
      const cleanup = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (cleanup.nextNode()) {
        const t = cleanup.currentNode;
        if (t.nodeValue && t.nodeValue.includes(CARET_TOKEN)) {
          t.nodeValue = t.nodeValue.split(CARET_TOKEN).join('');
        }
      }
      return;
    }

    // Fallback to absolute offset positioning if token not found
    if (!pos) return;
    const textNodes = getAllTextNodes(container);
    let remaining = pos.offset;
    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i];
      const len = tn.textContent.length;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(tn, Math.max(0, Math.min(remaining, len)));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
    }
    // Fallback to end
    if (textNodes.length) {
      const tn = textNodes[textNodes.length - 1];
      const range = document.createRange();
      range.setStart(tn, tn.textContent.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  window.DOMUtils = {
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
  };
})();
