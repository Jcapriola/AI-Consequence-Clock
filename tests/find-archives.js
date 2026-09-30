/*
 * Attaches existing Wayback Machine snapshots to every source in data/incidents.json.
 *
 * Run: node tests/find-archives.js
 *
 * Read-only against archive.org's CDX index. It records snapshots that already exist; it
 * does not submit anything for archiving.
 *
 * The CDX index is used rather than the simpler /wayback/available endpoint because that
 * endpoint answered 429 continuously across more than two minutes of spaced retries,
 * while CDX answered 200. CDX is also the endpoint that lets us ask for a snapshot from a
 * chosen point in time instead of whatever is nearest to now.
 *
 * Snapshots are preferred from the year the record was disclosed, because an archive taken
 * around the time we cited a source is better evidence of what the source said when it was
 * read. If nothing exists from that year onward we fall back to the earliest snapshot on
 * file, which still proves the page existed and is still retrievable.
 *
 * Why this matters: every evidence grade in this dataset rests on a URL resolving. Link
 * rot is the slow failure mode of any sourced project, and a dead primary source
 * silently downgrades a claim the page is still making.
 *
 * The three-state rule, which is the whole point of this script:
 *
 *   snapshot found   -> archived_url is the snapshot, archived_at is its date
 *   confirmed absent -> archived_url is null, archived_at is null
 *   lookup failed    -> the source is left untouched
 *
 * The third case is not the second. On an earlier run archive.org returned 429 and then
 * 503, and writing null for every source would have recorded "no snapshot exists" for
 * twenty nine sources when the truth was "the archive was unreachable". A dataset that
 * distinguishes verified from unverified must not let its own tooling assert an absence
 * it did not observe.
 */

var fs = require("fs");
var path = require("path");
var https = require("https");

var file = path.join(__dirname, "..", "data", "incidents.json");
var db = JSON.parse(fs.readFileSync(file, "utf8"));

var OK = "ok";
var ABSENT = "absent";
var FAILED = "failed";

/*
 * One CDX query. `from` biases toward a snapshot taken near when we cited the source.
 * A 504 here is normal for expensive index scans and is a failed lookup, never an absence.
 */
function cdx(url, from) {
  return new Promise(function (resolve) {
    var api =
      "https://web.archive.org/cdx/search/cdx?url=" +
      encodeURIComponent(url) +
      "&output=json&limit=1&filter=statuscode:200&fl=timestamp,original" +
      (from ? "&from=" + from : "");

    var req = https.get(
      api,
      { timeout: 60000, headers: { "User-Agent": "ai-consequence-clock-archive-check" } },
      function (res) {
        var body = "";
        res.on("data", function (c) {
          body += c;
        });
        res.on("end", function () {
          if (res.statusCode !== 200) {
            resolve({ state: FAILED, reason: "HTTP " + res.statusCode });
            return;
          }
          var parsed;
          try {
            parsed = JSON.parse(body);
          } catch (e) {
            // CDX serves an HTML error page on overload. Not a JSON absence.
            resolve({ state: FAILED, reason: "unparseable response" });
            return;
          }
          // Shape is [[header...],[row...]]. A header-only or empty body means no capture.
          if (!Array.isArray(parsed) || parsed.length < 2 || !Array.isArray(parsed[1])) {
            resolve({ state: ABSENT });
            return;
          }
          var ts = String(parsed[1][0] || "");
          if (!/^\d{8}/.test(ts)) {
            resolve({ state: FAILED, reason: "unexpected timestamp " + ts });
            return;
          }
          resolve({
            state: OK,
            url: "https://web.archive.org/web/" + ts + "/" + url,
            timestamp: ts
          });
        });
      }
    );
    req.on("timeout", function () {
      req.destroy();
      resolve({ state: FAILED, reason: "timeout" });
    });
    req.on("error", function (err) {
      resolve({ state: FAILED, reason: err.message });
    });
  });
}

/*
 * Ask for a contemporaneous snapshot first, then any snapshot. Only a genuine ABSENT from
 * the unconstrained query counts as "no snapshot exists", because an absence within one
 * year window says nothing about the archive as a whole.
 */
async function available(url, preferFromYear) {
  if (preferFromYear) {
    var near = await cdx(url, preferFromYear);
    if (near.state === OK) return near;
    if (near.state === FAILED) return near;
    await sleep(500);
  }
  return cdx(url, null);
}

/* Wayback timestamps are YYYYMMDDhhmmss. */
function toIsoDate(ts) {
  if (!ts || String(ts).length < 8) return null;
  var s = String(ts);
  return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
}

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

(async function () {
  var sources = [];
  db.incidents.forEach(function (record) {
    var year = String(record.disclosure_date || "").slice(0, 4);
    (record.sources || []).forEach(function (s) {
      sources.push({ record: record.id, source: s, year: /^\d{4}$/.test(year) ? year : null });
    });
  });

  var cache = Object.create(null);
  var found = 0;
  var absent = [];
  var failed = [];
  var skipped = 0;

  /*
   * Resume by default. A lookup costs roughly 40 seconds, so rechecking 29 sources to
   * retry the 5 that failed would take twenty minutes of requests against a free public
   * API to learn almost nothing. Sources already resolved are skipped; only the ones left
   * untouched by a failed lookup are attempted. Pass --recheck to force a full pass when
   * snapshots may have been added since.
   */
  var recheck = process.argv.indexOf("--recheck") !== -1;

  for (var i = 0; i < sources.length; i++) {
    var entry = sources[i];
    var url = String(entry.source.url || "").trim();
    if (!url) continue;

    if (!recheck && entry.source.archived_url !== undefined) {
      skipped++;
      if (entry.source.archived_url) found++;
      else absent.push(entry.record + " :: " + url);
      continue;
    }

    if (!(url in cache)) {
      cache[url] = await available(url, entry.year);
      await sleep(1000); // courtesy rate limit against a free public API
    }
    var result = cache[url];

    if (result.state === OK) {
      entry.source.archived_url = result.url;
      entry.source.archived_at = toIsoDate(result.timestamp);
      found++;
    } else if (result.state === ABSENT) {
      entry.source.archived_url = null;
      entry.source.archived_at = null;
      absent.push(entry.record + " :: " + url);
    } else {
      // Leave the source exactly as it was. Not observed is not the same as not there.
      failed.push(entry.record + " :: " + url + "  (" + result.reason + ")");
    }
    /*
     * Saved as we go. CDX takes roughly 40 seconds per lookup, so a full pass runs for
     * twenty minutes or more. Holding every result until the end would mean an interrupted
     * run discards work that was already correctly observed.
     */
    if (result.state !== FAILED) {
      fs.writeFileSync(file, JSON.stringify(db, null, 2) + "\n", "utf8");
    }
    process.stdout.write(
      "\r  checked " + (i + 1) + "/" + sources.length + "  found " + found + "  failed " + failed.length + "   "
    );
  }

  if (skipped) {
    console.log(
      "\n\nSkipped " + skipped + " source(s) already resolved on a previous run. Use --recheck to redo them."
    );
  }

  if (failed.length && failed.length === sources.length - skipped) {
    console.log("\n\nEvery lookup failed. archive.org looks unreachable, so nothing was written.");
    console.log("Re-run when it responds. First failure: " + (failed[0] || "n/a"));
    process.exit(2);
  }

  fs.writeFileSync(file, JSON.stringify(db, null, 2) + "\n", "utf8");

  console.log(
    "\n\nsources " +
      sources.length +
      " · snapshot found " +
      found +
      " · confirmed absent " +
      absent.length +
      " · lookup failed " +
      failed.length
  );
  if (absent.length) {
    console.log("\nNo snapshot exists yet (archive.org answered, nothing on file):");
    absent.forEach(function (m) {
      console.log("  " + m);
    });
  }
  if (failed.length) {
    console.log("\nNot checked, left untouched (lookup failed):");
    failed.forEach(function (m) {
      console.log("  " + m);
    });
  }
})();
