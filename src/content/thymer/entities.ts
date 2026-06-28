/**
 * Creator-role bucketing + Person/Organization routing, reading the live Zotero
 * API. (Moved out of the deleted `tana/` tree; Tana-free.)
 *
 *  - PRIMARY-ROLE-AWARE: the lead bucket holds the item type's *primary* creator
 *    role (author, but presenter/podcaster/director/... per type), resolved via
 *    Zotero.CreatorTypes.getPrimaryIDForType — so the real lead creator is
 *    captured for every item type.
 *  - fieldMode routing: institutional creators (single-field name, fieldMode 1)
 *    map to Organization; everyone else to Person. The reconciler dedups entity
 *    records by name, so the same org as author + publisher resolves to one record.
 */

const EDITOR_ROLE_NAMES = ['editor', 'seriesEditor'] as const;

/** An entity link: a name plus which entity collection it belongs to. */
export type CreatorLink = { name: string; tag: 'Person' | 'Organization' };

export type CreatorBuckets = {
  lead: CreatorLink[];
  editors: CreatorLink[];
  contributors: CreatorLink[];
};

/** "First Last" for people; the single-field name for institutions. */
export function creatorName(creator: Zotero.Creator): string {
  if (creator.fieldMode === 1) return creator.lastName.trim();
  return [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim();
}

/** Institutional creators (fieldMode 1) → Organization; everyone else → Person. */
function targetTag(creator: Zotero.Creator): CreatorLink['tag'] {
  return creator.fieldMode === 1 ? 'Organization' : 'Person';
}

/** Split an item's creators into { lead, editors, contributors }. */
export function bucketCreators(item: Zotero.Item): CreatorBuckets {
  const primaryID = Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID);
  const editorIDs = new Set(
    EDITOR_ROLE_NAMES.map((name) => Zotero.CreatorTypes.getID(name)).filter(
      (id): id is number => typeof id === 'number',
    ),
  );

  const lead: CreatorLink[] = [];
  const editors: CreatorLink[] = [];
  const contributors: CreatorLink[] = [];

  for (const creator of item.getCreators()) {
    const name = creatorName(creator);
    if (!name) continue;
    const entry: CreatorLink = { name, tag: targetTag(creator) };

    if (primaryID !== false && creator.creatorTypeID === primaryID) {
      lead.push(entry);
    } else if (editorIDs.has(creator.creatorTypeID)) {
      editors.push(entry);
    } else {
      contributors.push(entry);
    }
  }

  return { lead, editors, contributors };
}
