# CivicLens labeling rules

This file documents how the CivicLens training and test labels were produced,
so anyone can audit or redo them.

## Who labeled the data

**The reviewer was Claude, an AI assistant, not a human annotator.** It
looked at every image on numbered contact sheets (20 tiles per sheet,
`contact_sheets.py`) and recorded one decision per tile in `reviews.txt`.
This is the biggest caveat on the reported metrics: the labels have not been
checked by a person. They may contain systematic mistakes that a model built
on the same kind of vision-language technology would also make, which could
make the measured accuracy look better than it really is.

The pothole and crack sources (Pothole Dataset, DeepCrack, CrackForest) come
with their own human annotations and were **not** relabeled. Open Images
"street scene" negatives that were not reviewed keep their human-verified
Open Images scene label and are treated as `none` (see "Negatives" below).

## Files

| File | Purpose |
| --- | --- |
| `reviews.txt` | One line per contact sheet: `<sheet>: <default code>; <tile>=<code> ...` |
| `review/sheets/<sheet>.txt` | Image IDs on each sheet, in tile order (tile 0 = first line) |
| `review/*_unreviewed.txt` | Street-scene negatives that were not individually reviewed |
| `dataset.json` | Output of `build_dataset.py`: `{id, label, source, group, split}` per image |

## Codes

| Code | Label | Rule |
| --- | --- | --- |
| `P` | pothole | A hole or missing chunk of road surface |
| `C` | pavement_crack | Visible cracking in road or sidewalk surface, no missing material |
| `S` | sidewalk_damage | Lifted, broken or missing sidewalk slabs |
| `G` | graffiti | Unauthorized tagging or painting on public or private property in a street setting |
| `T` | overflowing_trash | Overflowing bins or loose litter in public space |
| `D` | illegal_dumping | Furniture, mattresses, bags or debris left on a street or lot |
| `N` | damaged_sign | A bent, knocked-down, faded or vandalized traffic or street sign |
| `F` | fallen_tree | A tree or large branch down across a road, sidewalk or property |
| `W` | flooding | Standing water covering a road or sidewalk |
| `O` | pedestrian_obstruction | Something blocking a sidewalk or curb ramp |
| `0` | none | A real outdoor scene with no visible civic issue |
| `X` | exclude | Ambiguous, not a real-world photo, people as the main subject, or an artwork close-up |

## Rules

1. Label what is **visible**, not what the source category says. An Open
   Images "graffiti" photo of a sanctioned mural in a gallery is `X`; a
   "litter" photo showing a clean park is `0`.
2. Exclude when unsure. `X` removes the image from both training and test.
3. Exclude images where a person is the main subject, so the model is never
   trained to react to people.
4. Exclude close-ups of artwork, product shots, illustrations and screenshots.
5. One label per image. If an image shows two issues, the more prominent one
   wins; if neither dominates, the image is excluded.
6. An image that appears on two sheets with different non-`X` labels is
   reported as a conflict by `build_dataset.py` (there were none).

## Order and bias

Positive candidate pools were reviewed in full, in **random** order
(`prepare_review.py`), not sorted by the zero-shot model, so the reviewed set
is not biased toward images the model already finds easy.

## Negatives

For the three street-scene pools (`roads`, `urban_scenes`,
`street_furniture`), only the 15% most "issue-like" images (by zero-shot
score) were reviewed, because that is where label noise matters most. The
rest (`review/*_unreviewed.txt`) are labeled `none` from their Open Images
scene label alone. To check what the ranking might miss, a random sample of
60 unreviewed negatives was also reviewed (the `audit_*` sheets): none showed
a civic issue, and 2 were excluded as unclear. A few unreviewed negatives may
still contain a minor issue. The `ranked_*` sheets are the reviewed 15%.

## Splitting

Near-duplicate photos (full-frame embedding cosine >= 0.985) are grouped with
union-find, and a group never straddles train and test. Groups are split
75/25 per majority label with seed 2026. Validation for threshold and
temperature fitting is carved out of the training split only
(`build_head.py`). The test split was used once, for the final evaluation.

## Categories that were dropped

`sidewalk_damage`, `damaged_sign`, `fallen_tree` and
`pedestrian_obstruction` had too few clean examples (under 15 each) to train
or evaluate honestly. The model does not detect them, and the app says so
instead of guessing. Users can still pick these categories by hand when
writing a report.

Their photos are kept, but `build_head.py` and `evaluate.ts` count them as
`none`. So the model's `none` class means "none of the six supported
issues", not "nothing wrong here": 17 training photos and 5 test photos
labeled `none` show one of these unsupported problems.
