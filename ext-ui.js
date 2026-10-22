// Pixprite UI kit for extension pages, loaded next to ext-ui.css.
// Every <select> gets the editor's own drop-down list instead of the browser's: the select stays
// in the page (hidden), keeps its value and fires `change` as usual, so pages need no changes.
// A select added later (pages that build their forms in code) is picked up as well.
(function () {
  'use strict';
  var done = new WeakSet();
  var open = null;

  function label(select) {
    var o = select.options[select.selectedIndex];
    return o ? o.textContent : '';
  }

  function close() {
    if (!open) return;
    open.list.remove();
    open.trigger.setAttribute('aria-expanded', 'false');
    open = null;
  }

  function pick(select, trigger, index) {
    if (index < 0 || select.options[index].disabled) return;
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    trigger.firstChild.textContent = label(select);
    close();
    trigger.focus();
  }

  function show(select, trigger) {
    close();
    var list = document.createElement('div');
    list.className = 'px-select-list';
    list.setAttribute('role', 'listbox');
    var active = select.selectedIndex;
    var items = Array.prototype.map.call(select.options, function (o, i) {
      var item = document.createElement('div');
      item.className = 'px-select-item';
      item.textContent = o.textContent;
      item.setAttribute('role', 'option');
      if (i === select.selectedIndex) item.dataset.selected = 'true';
      if (o.disabled) item.dataset.disabled = 'true';
      item.addEventListener('pointerenter', function () { mark(i); });
      item.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      item.addEventListener('click', function () { pick(select, trigger, i); });
      list.appendChild(item);
      return item;
    });
    function mark(i) {
      if (items[active]) delete items[active].dataset.active;
      active = i;
      if (items[i]) { items[i].dataset.active = 'true'; items[i].scrollIntoView({ block: 'nearest' }); }
    }
    document.body.appendChild(list);
    // Under the trigger, or above it when there is no room; at least as wide as the trigger
    var r = trigger.getBoundingClientRect();
    list.style.minWidth = r.width + 'px';
    var below = innerHeight - r.bottom - 4, above = r.top - 4;
    // offsetHeight counts the border and padding, so a list that fits shows no scroll bar
    var h = Math.min(list.offsetHeight, Math.max(below, above));
    list.style.maxHeight = h + 'px';
    list.style.top = (below >= h || below >= above ? r.bottom : r.top - h) + 'px';
    list.style.left = Math.max(0, Math.min(r.left, innerWidth - list.offsetWidth)) + 'px';
    mark(active);
    trigger.setAttribute('aria-expanded', 'true');
    open = { list: list, trigger: trigger, select: select, mark: mark, active: function () { return active; } };
  }

  function step(dir) {
    var o = open.select.options, i = open.active();
    for (var k = 0; k < o.length; k++) {
      i = (i + dir + o.length) % o.length;
      if (!o[i].disabled) return open.mark(i);
    }
  }

  function enhance(select) {
    if (done.has(select) || select.multiple || select.size > 1) return;
    done.add(select);
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'px-select ' + select.className;
    trigger.title = select.title;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.disabled = select.disabled;
    var text = document.createElement('span');
    text.textContent = label(select);
    trigger.appendChild(text);
    trigger.insertAdjacentHTML('beforeend', '<svg width="7" height="4" viewBox="0 0 7 4" shape-rendering="crispEdges"><path d="M0 0h7v1H0zM1 1h5v1H1zM2 2h3v1H2zM3 3h1v1H3z" fill="currentColor"/></svg>');
    select.style.display = 'none';
    select.after(trigger);
    // Changes made in code show on the trigger
    select.addEventListener('change', function () { text.textContent = label(select); });
    trigger.addEventListener('click', function () {
      if (open && open.trigger === trigger) close(); else show(select, trigger);
    });
    trigger.addEventListener('keydown', function (e) {
      if (open && open.trigger === trigger) {
        if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(select, trigger, open.active()); }
        else if (e.key === 'Escape' || e.key === 'Tab') close();
      } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        show(select, trigger);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // A focused closed list steps through the values without opening, like a native select
        e.preventDefault();
        var dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1, o = select.options;
        for (var i = select.selectedIndex + dir; i >= 0 && i < o.length; i += dir) {
          if (!o[i].disabled) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    });
  }

  function scan(root) {
    if (root.tagName === 'SELECT') enhance(root);
    if (root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll('select'), enhance);
  }

  document.addEventListener('pointerdown', function (e) {
    if (open && !open.list.contains(e.target) && !open.trigger.contains(e.target)) close();
  }, true);
  addEventListener('blur', close);
  addEventListener('resize', close);
  document.addEventListener('scroll', function (e) { if (open && !open.list.contains(e.target)) close(); }, true);

  function start() {
    scan(document.body);
    new MutationObserver(function (records) {
      records.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
