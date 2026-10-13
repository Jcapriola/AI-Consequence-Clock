/*
 * Draws where a record's sources got their information.
 *
 * Rendering only. Which sources share a root, and the verdict, come from
 * ClockEvidence.sourceRoots(); this file decides where boxes go and nothing else.
 *
 * Known limit: links are drawn straight, so in a root with more than three sources or
 * more than three shared origins a link can pass behind another box.
 */
(function () {
  "use strict";

  var E = window.ClockEvidence;

  var BOX_W = 220;
  var BOX_H = 54;
  var GAP = 18;
  var ROW_GAP = 34;
  var PAD = 14;
  var HEAD = 22;
  var ROOT_GAP = 46;
  var COLUMNS = 3;
  var MAX_W = 790;
  var NAME_LENGTH = 30;

  var KIND_TEXT = {
    ORIGINAL: "original evidence",
    DERIVED: "restates another source",
    UNKNOWN: "origin not recorded"
  };
  var VERDICT_CLASS = {
    INDEPENDENT_CONFIRMED: "roots-confirmed",
    SINGLE_ROOT: "roots-single",
    INDETERMINATE: "roots-open",
    NO_QUALIFYING_SOURCES: "roots-open"
  };

  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function num(value) {
    return Number(value).toLocaleString("en-US");
  }

  function shorten(text) {
    var value = String(text === null || text === undefined ? "" : text);
    return value.length > NAME_LENGTH ? value.slice(0, NAME_LENGTH - 3) + "..." : value;
  }

  function layoutComponent(component) {
    var count = component.members.length;
    var columns = Math.min(count, COLUMNS);
    var rows = Math.ceil(count / COLUMNS);
    var rootCount = component.external_roots.length;
    var inner = Math.max(columns, Math.min(rootCount, COLUMNS)) * (BOX_W + GAP) - GAP;
    var gridHeight = rows * BOX_H + (rows - 1) * ROW_GAP;
    var boxes = component.members.map(function (source, index) {
      return {
        source: source,
        links: E.sourceLinks(source),
        x: PAD + (index % COLUMNS) * (BOX_W + GAP),
        y: PAD + HEAD + Math.floor(index / COLUMNS) * (BOX_H + ROW_GAP)
      };
    });
    var roots = component.external_roots.map(function (key, index) {
      return {
        key: key,
        x: PAD + (inner - (Math.min(rootCount, COLUMNS) * (BOX_W + GAP) - GAP)) / 2 + (index % COLUMNS) * (BOX_W + GAP),
        y: PAD + HEAD + gridHeight + ROOT_GAP + Math.floor(index / COLUMNS) * (BOX_H + GAP)
      };
    });
    var rootRows = Math.ceil(rootCount / COLUMNS);
    return {
      component: component,
      boxes: boxes,
      roots: roots,
      width: inner + PAD * 2,
      height: PAD * 2 + HEAD + gridHeight + (rootCount ? ROOT_GAP + rootRows * (BOX_H + GAP) - GAP : ROW_GAP - PAD)
    };
  }

  function placeComponents(layouts) {
    var x = 0;
    var y = 0;
    var rowHeight = 0;
    var width = 0;
    layouts.forEach(function (layout) {
      if (x > 0 && x + layout.width > MAX_W) {
        x = 0;
        y += rowHeight + GAP;
        rowHeight = 0;
      }
      layout.x = x;
      layout.y = y;
      x += layout.width + GAP;
      rowHeight = Math.max(rowHeight, layout.height);
      width = Math.max(width, x - GAP);
    });
    return { width: Math.max(width, 1), height: y + rowHeight };
  }

  function boxMarkup(x, y, title, subtitle, className, fullTitle) {
    return (
      '<g class="' + className + '">' +
      "<title>" + esc(fullTitle) + "</title>" +
      '<rect x="' + x + '" y="' + y + '" width="' + BOX_W + '" height="' + BOX_H + '" rx="9"/>' +
      '<text class="roots-name" x="' + (x + 12) + '" y="' + (y + 22) + '">' + esc(shorten(title)) + "</text>" +
      '<text class="roots-kind" x="' + (x + 12) + '" y="' + (y + 41) + '">' + esc(shorten(subtitle)) + "</text>" +
      "</g>"
    );
  }

  function line(x1, y1, x2, y2) {
    return '<line class="roots-link" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
  }

  function arc(from, to) {
    var x1 = from.x + BOX_W / 2;
    var x2 = to.x + BOX_W / 2;
    var y1 = from.y + BOX_H;
    var y2 = to.y + BOX_H;
    var dip = Math.max(y1, y2) + ROW_GAP - 8;
    return (
      '<path class="roots-link" d="M' + x1 + " " + y1 + " Q" + (x1 + x2) / 2 + " " + dip + " " + x2 + " " + y2 + '"/>'
    );
  }

  function linksMarkup(layout) {
    var parts = [];
    layout.boxes.forEach(function (box) {
      box.links.external.forEach(function (key) {
        layout.roots.forEach(function (root) {
          if (root.key === key) parts.push(line(box.x + BOX_W / 2, box.y + BOX_H, root.x + BOX_W / 2, root.y));
        });
      });
      box.links.internal.forEach(function (ref) {
        layout.boxes.forEach(function (other) {
          if (other !== box && other.source.id === ref) parts.push(arc(box, other));
        });
      });
    });
    return parts.join("");
  }

  function sourceBox(box) {
    var subtitle = box.links.qualifying ? KIND_TEXT[box.links.kind] : "roundup, not counted";
    var className = "roots-box" + (box.links.qualifying ? "" : " roots-box-weak");
    return boxMarkup(box.x, box.y, box.source.publisher, subtitle, className, box.source.publisher);
  }

  /* An untraced group is not called a piece of evidence: it may repeat another one. */
  function groupHeading(component, index) {
    if (!component.qualifying) return "NOT COUNTED";
    if (component.untraced) return "ORIGIN NOT RECORDED";
    return "PIECE OF EVIDENCE " + num(index + 1);
  }

  function componentMarkup(layout, index) {
    return (
      '<g transform="translate(' + layout.x + " " + layout.y + ')">' +
      '<rect class="roots-group" width="' + layout.width + '" height="' + layout.height + '" rx="13"/>' +
      '<text class="roots-head" x="' + PAD + '" y="' + (PAD + 10) + '">' +
      esc(groupHeading(layout.component, index)) +
      "</text>" +
      linksMarkup(layout) +
      layout.boxes.map(sourceBox).join("") +
      layout.roots
        .map(function (root) {
          return boxMarkup(root.x, root.y, "Shared origin", root.key, "roots-box roots-box-origin", root.key);
        })
        .join("") +
      "</g>"
    );
  }

  function ordered(components) {
    return components
      .filter(function (component) {
        return component.qualifying;
      })
      .concat(
        components.filter(function (component) {
          return !component.qualifying;
        })
      );
  }

  function graph(roots) {
    var layouts = ordered(roots.components).map(layoutComponent);
    if (!layouts.length) return '<p class="roots-note">No sources attached.</p>';
    var size = placeComponents(layouts);
    return (
      '<div class="roots-scroll">' +
      '<svg class="roots-graph" viewBox="0 0 ' + size.width + " " + size.height + '" width="' + size.width +
      '" height="' + size.height + '" role="img" aria-label="Sources grouped by where their information came from">' +
      layouts.map(componentMarkup).join("") +
      "</svg></div>"
    );
  }

  function panel(heading, strong, detail, className) {
    return (
      '<div class="roots-panel' + (className ? " " + className : "") + '">' +
      "<b>" + esc(heading) + "</b><strong>" + esc(strong) + "</strong>" +
      "<span>" + esc(detail) + "</span></div>"
    );
  }

  function section(record, open) {
    var roots = E.sourceRoots(record);
    var verdict = E.verdictDefinition(roots.verdict);
    var verdictClass = VERDICT_CLASS[roots.verdict];
    return (
      '<details class="roots"' + (open ? " open" : "") + ">" +
      "<summary>Where the facts came from" +
      '<span class="tag roots-tag ' + verdictClass + '">' + esc(verdict.label) + "</span>" +
      "</summary>" +
      graph(roots) +
      '<div class="roots-compare">' +
      panel(
        "Published check: publisher names",
        num(roots.distinct_publisher_count) + " differently named",
        "Publishers carrying evidence that qualifies for the headline rule.",
        ""
      ) +
      panel(
        "Audit: pieces of evidence",
        verdict.label,
        verdict.text,
        verdictClass
      ) +
      "</div>" +
      '<p class="roots-note">Sources inside one outline share an origin: the same publisher or site, a citation ' +
      "between them, or the same outside source. This view changes no published number.</p>" +
      "</details>"
    );
  }

  window.ClockSourceGraph = { section: section };
})();
