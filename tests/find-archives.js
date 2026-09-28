/*
 * Attaches existing Wayback Machine snapshots to every source in data/incidents.json.
 *
 * Run: node tests/find-archives.js
 *
 * Read-only against archive.org's availability API. It records snapshots that already
 * exist; it does not submit anything for archiving.
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

function available(url) {
  return new Promise(function (resolve) {
    var api = "https://archive.org/wayback/available?url=" + encodeURIComponent(url);
    var req = https.get(api, { timeout: 20000, headers: { "User-Agent": "ai-consequence-clock-archive-check" } }, function (res) {
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
          resolve({ state: FAILED, reason: "unparseable response" });
          return;
        }
        var snap = parsed && parsed.archived_snapshots && parsed.archived_snapshots.closest;
        if (snap && snap.available && snap.url) {
          resolve({
            state: OK,
            url: String(snap.url).replace(/^http:/, "https:"),
            timestamp: snap.timestamp
          });
          return;
        }
        resolve({ state: ABSENT });
      });
    });
    req.on("timeout", function () {
      req.destroy();
      resolve({ state: FAILED, reason: "timeout" });
    });
    req.on("error", function (err) {
      resolve({ state: FAILED, reason: err.message });
    });
  });
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
    (record.sources || []).forEach(function (s) {
      sources.push({ record: record.id, source: s });
    });
  });

  var cache = Object.create(null);
  var found = 0;
  var absent = [];
  var failed = [];

  for (var i = 0; i < sources.length; i++) {
    var entry = sources[i];
    var url = String(entry.source.url || "").trim();
    if (!url) continue;

    if (!(url in cache)) {
      cache[url] = await available(url);
      await sleep(500); // courtesy rate limit against a free public API
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
    process.stdout.write("\r  checked " + (i + 1) + "/" + sources.length + "   ");
  }

  if (failed.length === sources.length) {
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
