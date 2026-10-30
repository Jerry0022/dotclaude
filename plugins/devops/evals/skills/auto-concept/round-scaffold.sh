#!/usr/bin/env bash
# Shared scaffold of the round-2 cases: notes-cli with an open decision
# concept whose round 1 (JSON file / SQLite / Markdown files) the user just
# submitted. $1 = the case's submission payload; it lands next to the page as
# the file the bridge would have handed over. The bridge, the browser, crons
# and kills are denied in each prompt.md.
set -e
PAYLOAD="$1"
NAME=20261030-1200-notes-storage
DIR="docs/concepts/$NAME"
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
git checkout -q -b main 2>/dev/null || git switch -q -c main
cat > README.md <<'MD'
# notes-cli

A small CLI that stores personal notes. Notes are currently kept in memory
and lost on exit; persistence is the next step. The owner uses it on two
laptops and keeps the notes folder in a git repository.
MD
cat > package.json <<'JSON'
{ "name": "notes-cli", "version": "0.1.0", "private": true, "main": "index.js" }
JSON
cat > index.js <<'JS'
const notes = [];
function add(text) { notes.push({ id: notes.length + 1, text, at: Date.now() }); }
function list() { return notes.slice(); }
module.exports = { add, list };
JS
mkdir -p "$DIR/rounds"
cat > "$DIR/page.json" <<'JSON'
{
  "title": "notes-cli: Persistenz",
  "subtitle": "Wie speichert notes-cli seine Notizen?",
  "locale": "de",
  "mode": "decision",
  "pageVersion": "2026-10-30T12:00:00.000Z",
  "lastBuild": "2026-10-30T12:00:00.000Z"
}
JSON
variant() { # id label body
  cat <<HTML
  <section id="$1" class="variant-card" data-nav-label="$2">
    <h3>$2</h3>
    <p>$3</p>
    <div class="variant-evaluation" data-decision="$1" data-label="$2">
      <div class="eval-group">
        <label class="eval-option"><input type="radio" name="eval-$1" value="discard"><span class="eval-label">{{variant.discard}}</span></label>
        <label class="eval-option"><input type="radio" name="eval-$1" value="include"><span class="eval-label">{{variant.include}}</span></label>
      </div>
      <textarea id="$1-note" data-comment="$1-note" rows="2"></textarea>
    </div>
  </section>
HTML
}
{
  echo '<section data-iteration="1" data-iteration-template="decision">'
  echo '  <div class="iteration-intro"><h2>Runde 1 — drei Speicherwege</h2><p>notes-cli verliert heute alles beim Beenden. Drei Wege, die Notizen dauerhaft zu speichern.</p></div>'
  variant variant-json "JSON-Datei" "Eine notes.json, beim Speichern komplett neu geschrieben. Null Abhängigkeiten."
  variant variant-sqlite "SQLite" "Eine notes.db über better-sqlite3. Abfragen, Indizes, Transaktionen."
  variant variant-markdown "Markdown-Dateien" "Eine .md-Datei pro Notiz in einem Ordner. Mit jedem Editor lesbar."
  echo '</section>'
} > "$DIR/rounds/01.html"
node "$(dirname "$0")/../../../scripts/concept-build.js" build "$DIR" >/dev/null
cp "$PAYLOAD" "docs/concepts/$NAME-submission-01.json"
mkdir -p .claude
cat > .claude/concept-active.json <<JSON
{ "concept": "$DIR.html", "source": "$DIR", "round": 1, "bridge": "down" }
JSON
git add -A && git commit -qm "chore: init with concept round 1"
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
