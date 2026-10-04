# 12A. Concurrent Edits

## Scope

A collection is edited by many tools at once: an application writing through
an engine, a person in a text editor, a synchronization tool, an agent. This
chapter defines the data semantics that let those edits meet without losing
either one:

- how a record keeps its identity without any ID in its file, and how a moved
  file is recognized as the same record
- the three-way record merge, which combines two concurrent versions of a
  record against their common base
- the format fidelity rule that every writer follows, so that a write changes
  only the bytes it means to change

This specification does not define when a tool merges, how edits travel
between devices, logs, sequencers, ordering services, conflict envelopes, how
a conflict is held or shown to a person, or what happens when one side deletes
a record that the other side edited. Those are implementation concerns. A tool
that never reconciles concurrent edits, such as a command-line validator, does
not need this chapter's merge function and does not claim the `merge`
profile.

## Record Identity

A record is identified by its collection-relative path. Record files carry no
required mdbase metadata:

- An implementation MAY keep an internal identity for each record, for example
  to follow it across moves or to key its history.
- Such identities, revisions, merge bases, and other bookkeeping MUST be kept
  outside record files, for example in `.mdbase/` or the implementation's own
  storage.
- An implementation MUST NOT write an identity into a record's frontmatter or
  body, and MUST NOT require one to read, validate, query, or write a record.

A collection may still store its own identifiers in frontmatter, such as a
TaskNotes `id` field. When `settings.id_field` names such a field, it is used
for ID-based link resolution (Chapter 08) and as an identity hint for move
detection below. It remains ordinary user data.

## Move Detection

Tools that watch a collection see moves made by other tools as a file
disappearing at one path and a file appearing at another. A tool that reports
moves, follows a record's internal identity across them, or keeps merge bases
across them MUST pair disappearances and appearances with the rules below.

### Observation window

A disappearance and an appearance can pair when the tool observes both within
one **observation window**. A window MUST span at least 5 seconds, so that a
deletion and a creation that a file watcher reports in separate batches still
pair. A scan that compares the collection with the state a tool last recorded,
for example on start-up after the tool was not running, treats everything it
finds as one window.

For each disappeared record the tool uses the last bytes and file identity it
observed. For each appeared record it uses the current bytes and file
identity. A **file identity** is a platform identifier that survives a rename,
such as a device and inode number or a Windows file ID. A tool that cannot
observe file identities skips the rule that uses them.

### Pairing rules

A disappeared record `D` and an appeared record `A` are a **candidate pair**
under the first of these rules that holds:

| Rank | Rule |
| --- | --- |
| 0 | `settings.id_field` is configured and both `D` and `A` hold the same non-empty string value for it |
| 1 | `D` and `A` have identical bytes |
| 2 | `D` and `A` have the same file identity and a similarity of at least 0.5 |
| 3 | `D` and `A` have the same file name (`file.name`) and a similarity of at least 0.8 |

When `settings.id_field` is configured and both `D` and `A` hold non-empty
string values for it that differ, they are never a candidate pair, whatever
the other rules say. The identity hint wins whenever both sides have one.

The **similarity** of two files is the Jaccard index of their line sets: each
file's lines are trimmed of leading and trailing whitespace, empty lines are
discarded, and the remaining distinct lines form the set. The similarity is
the size of the intersection divided by the size of the union. Two files with
empty line sets have similarity 1.

Candidate pairs are chosen greedily in this order:

1. lower rank first
2. higher similarity first
3. smaller `D` path in Unicode code-point order first
4. smaller `A` path in Unicode code-point order first

A chosen pair removes both its records from further pairing. Each chosen pair
is one record that moved from `D`'s path to `A`'s path, and possibly also
changed. Every disappearance left unpaired is a deletion and every appearance
left unpaired is a creation.

Unrelated files never pair: a file deleted at one path and a different file
created at another, with different bytes, file identity, and name, are a
deletion and a creation.

A tool reports a detected move as `record_renamed` (Chapter 14), followed by
`record_modified` when the bytes also changed. Internal identity, history, and
merge bases follow the record to its new path.

**Provisional (rc.5).** The 5-second minimum window and the 0.5 and 0.8
thresholds come from the feasibility prototype's measurements and may be
tuned before release.

## Three-Way Record Merge

### Inputs and result

The merge combines two concurrent versions of one record. Its inputs are:

- the **base**: the version both edits started from
- the **first** and **second** versions: the two edited versions, in an order
  supplied by the caller of the merge, such as the order in which an engine
  confirmed them
- the type registry

Each version consists of a path, a persisted frontmatter mapping with its
source text, and a body. Merge strategies (Chapter 07) come from the types
that the first version matches at its path.

The result is a **merged version** and a possibly empty list of
**conflicts**. A conflict has a `kind`: `field` for one top-level frontmatter
field, which it names in `field`; `frontmatter` for a whole frontmatter
block; `body`; or `path`. It carries the base, first, and second values.

Conflicts are listed in this order: field conflicts in key order (the first
version's keys in its order, then keys only the second version has, in its
order, then keys only the base has, in its order), then a `frontmatter`
conflict, then a `body` conflict, then a `path` conflict.
Where a conflict exists, the merged version holds the first version's value.
A tool that writes a merged version with conflicts MUST NOT discard the second
version's conflicting values silently: how it keeps and surfaces them is
implementation behavior.

The merge is a pure function: the same inputs always produce the same result.
It reads no clock and no other record. When one edited version has the same
bytes as the base, the merged version is the other edited version, byte for
byte; when the two edited versions have the same bytes, the merged version is
that version.

### Equality

Two frontmatter values are equal under deep JSON equality, where numbers are
equal when their numeric values are equal, strings are compared exactly, and
there is no coercion between types. A missing key is a state of its own: it is
equal only to another missing key, and never equal to null.

### Frontmatter

The frontmatter merges one top-level key at a time. For each key present in
the base, the first version, or the second version, with `B`, `F`, and `S`
standing for that key's state in each:

1. If `F` equals `S`, the result is `F`. Both sides made the same change, or
   neither changed the key.
2. Otherwise, if `S` equals `B`, the result is `F`: only the first side
   changed the key.
3. Otherwise, if `F` equals `B`, the result is `S`: only the second side
   changed the key.
4. Otherwise both sides changed the key differently, and the key's strategy
   decides. When the matched types declare different strategies for the key
   (a `type_conflict`, Chapter 05), the key uses `conflict`: a merge never
   fails and never drops a value it cannot decide. Reading the merged record
   still reports the `type_conflict`.

| Strategy | Result when both sides changed the key differently |
| --- | --- |
| `conflict` | a conflict of kind `field` on the key |
| `max` | the greater of `F` and `S` |
| `min` | the lesser of `F` and `S` |
| `union` | the observed-remove union of `F` and `S` |

**`max` and `min`.** Two values are ordered as follows:

- two numbers by numeric value
- two strings that are both RFC 3339 date-times with an offset, as instants
- two strings that are both RFC 3339 `full-date` values, in calendar order
- any other two strings, in Unicode code-point order

A present value is greater than a missing key under `max`, and also preferred
over a missing key under `min`, so a value survives a concurrent removal. When
`F` and `S` are incomparable, for example a number and a string, or null and a
value, the key is in conflict. When they are equal under the ordering but not
equal values, such as one instant written with two offsets, the result is `F`.

**`union`.** Each of `B`, `F`, and `S` is read as a list: a list as itself, a
missing key or null as the empty list, and, for the `tags` field only, a
string as a one-item list. If any of them is another value, the key is in
conflict. Otherwise the result is:

1. every item of `F` that is not an item of `B` removed by `S` (an item of `B`
   absent from `S`), in `F`'s order
2. followed by every item of `S` that is not in `B` and not already in the
   result, in `S`'s order

Items are compared with the equality above. Additions from both sides are
kept, and an item removed on either side stays removed unless the other side
added it again. When the result is empty and `F` or `S` is a missing key, the
key is missing from the merged version; otherwise the result is a list.

A key whose value came from one side unchanged takes that side's source text
under the format fidelity rule below. A value computed by `union`, or a `max`
or `min` result written in a different form, is re-emitted.

The merged frontmatter source starts from the first version's source. Comment
and blank lines between entries therefore come from the first version.

**Provisional (rc.5).** Comment or blank lines between entries that only
the second version changed are not carried into the merged version, unless the
first version has the same bytes as the base. A later release candidate may merge them as
text.

When the frontmatter of any of the three versions is not a mapping, the whole
frontmatter is one unit: the result follows rules 1 to 3 above on its source
text, and otherwise there is one conflict of kind `frontmatter`.

### Body

The body merges line by line. A line is a run of characters ending with a line
terminator (`\n` or `\r\n`), or the final run of characters without one. Lines
are compared exactly, including their terminators. With `B`, `F`, and `S`
standing for the three bodies:

1. If `F` equals `S`, or `S` equals `B`, the result is `F`. If `F` equals `B`,
   the result is `S`.
2. **Append-append.** If `F` and `S` both begin with all of `B`, so that both
   sides only appended text at the end, the result is `B`, then `F`'s
   appended text, then `S`'s appended text, joined as follows:
   - when `B` is not empty and does not end with a line terminator, and both
     appended texts begin with one, the line terminator at the start of
     `S`'s text is dropped: `F`'s text already ended `B`'s last line;
   - then, when `F`'s appended text is not empty and does not end with a line
     terminator, and `S`'s remaining text does not begin with one, a line
     terminator is inserted between the two, in the body's line-ending style:
     the style of `B`'s first line terminator, or when `B` has none, of the
     first line terminator in `F`'s and then `S`'s appended text, and `\n`
     when there is none at all. A merge therefore never mixes `\n` and
     `\r\n` in a body that used one style.

   So no empty line appears between the two appends. Journals, logs, and
   checklists grow this way, and appending to them concurrently is not a
   conflict.
3. Otherwise the bodies merge as a three-way line merge (diff3). The lines of
   `B` that are aligned with unchanged lines in both `F` and `S` divide the
   bodies into stable regions and changed chunks. For each changed chunk, the
   result takes the side that changed it; where both sides changed a chunk to
   the same lines, those lines; and where both sides changed a chunk
   differently, the body is in conflict.

When the body is in conflict, the merged body is `F` as a whole and the
conflict carries the three bodies. The alignment of `B` with each side is a
longest common subsequence of lines, chosen as follows, so that every
implementation splits chunks the same way:

1. Lines common to the start of both sequences are aligned, then lines
   common to their end.
2. The remaining middle parts are split at the **middle snake** of Myers'
   linear-space algorithm (E. Myers, "An O(ND) Difference Algorithm and Its
   Variations", 1986, section 4b), in the formulation of diff-match-patch's
   `bisect`: for each edit distance `d` the forward search runs before the
   reverse search; on each diagonal a search continues from the neighbouring
   diagonal with the larger furthest-reaching value, and from the lower
   diagonal (a deletion) when they are equal; the split point is the forward
   search's furthest-reaching point on the diagonal where the searches first
   overlap.
3. Each part is aligned recursively with these rules.

The executable model (`scripts/concurrent_edits_model.py`, `_lcs_pairs`)
is the reference for this procedure.

**Provisional (rc.5).** Earlier drafts left the choice among several longest
common subsequences open. The procedure above is the one the reference model
and the first engine implement. A later release may name a simpler canonical
alignment if one proves as fast.

**Provisional (rc.5).** Append-append applies only to appends at the end
of the body. Two insertions at the same place inside the body remain a
conflict.

### Body edits

An update with `body_edits` (Chapter 12) is a body merge whose second version
is built from the request: the base body with the edits applied. The current
body is the first version. Append-append applies as usual, so an edit that
only appends to the end of the base combines with a concurrent append, the
current text first. An edit range that overlaps a concurrent change to the
same lines is a body conflict.

### Path

When the first and second versions have different paths, the path merges like
a frontmatter key with the `conflict` strategy: one side's move wins over an
unchanged path, and two different moves are a conflict of kind `path`. The merged
path then goes through the path collision rule of Chapter 02.

### Validity and lifecycle

The merge never checks validity. A merged version is validated when it is
read, like any other record, and its issues are reported (Chapter 04). It is
never rejected, and it is never turned into a conflict because it is invalid,
even when both sides were valid on their own: for example, two edits that
each keep a record within an `if`/`then` schema can together leave it outside.

Membership of the merged version is recomputed from its path and frontmatter
and may differ from the base. The merge does not run lifecycle; managed values
such as `dateModified` combine through their strategies.

## Writer Format Fidelity

Every tool that writes changes to the frontmatter of an existing record,
through an update, a lifecycle assignment, a merge, or a reference update
after a rename, MUST follow this rule. It applies to Markdown records and YAML
document records alike.

A frontmatter source consists of **top-level entries** and the lines between
them. An entry is a line that begins a top-level key at column 0, together
with every following line up to the last line of that key's value, and then
any directly following blank and indented comment lines up to the last
indented comment line. Lines inside the value belong to the entry even when
they are blank or column-0 comments, such as a comment between two `- ` items
of a block sequence at column 0. Blank lines and comment lines at column 0
after the value are not part of any entry.

1. An entry whose key the write does not change MUST stay byte-identical,
   including its comments, quoting, indentation, and position.
2. Lines that are not part of any entry MUST be kept, except that removing an
   entry removes its own lines only.
3. A changed entry is re-emitted in place. When the previous value was a flow
   collection, such as `tags: [a, b]`, the new value MUST be written as a flow
   collection, and a block collection MUST stay in block style. Writers
   SHOULD keep a scalar's quoting style and a trailing comment on the entry's
   first line when the new value can be written that way.
4. A new key is appended after the last entry.
5. A value that a merge takes unchanged from one side MUST be copied verbatim
   from that side's source text for the entry.
6. The byte-order mark, the frontmatter delimiters, the line ending style, and
   the body, unless the write changes the body, MUST stay as they were.

A whole-document `document` replacement (Chapter 12) is written exactly as
supplied and is outside this rule.

The rule keeps unrelated bytes stable, so files diff cleanly in Git and a
write never manufactures a change on a line it did not mean to touch. Byte
changes beyond the edited keys would also turn into needless conflicts in the
next merge.
