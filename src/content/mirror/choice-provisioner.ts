/**
 * Provision missing choice options over MCP before mirror files are written.
 *
 * The mirror silently DROPS a choice value whose option doesn't exist yet
 * (spike T1) — no error, and the file keeps the value, so file and record
 * quietly diverge. The one thing files can't do is grow the option list, so
 * the pipeline diffs the demanded values against the on-disk `_plugin.json`
 * (free) and only when something is missing does the MCP read-modify-write
 * of the collection config (validated end-to-end in the spike addendum:
 * provision-then-write lands within one sync cycle).
 */

import type { DesiredState } from '../thymer/desired-state';
import { ThymerMcpError, type ThymerMcpClient } from '../thymer/mcp-client';

import {
  CHOICE_FIELD_IDS,
  REFERENCES_COLLECTION_NAME,
  REFERENCE_LABELS,
  loadFolderSchema,
} from './mirror-schema';

type ChoiceOption = {
  id: string;
  label: string;
  icon?: string;
  active?: boolean;
  color?: string;
};

type ConfigField = {
  id: string;
  label?: string;
  choices?: ChoiceOption[];
};

/** field id → labels the blobs want to use. */
type Demand = Map<string, Set<string>>;

export async function provisionChoices(
  client: ThymerMcpClient,
  root: string,
  blobs: DesiredState[],
): Promise<void> {
  const demand = collectDemand(blobs);
  if (![...demand.values()].some((labels) => labels.size)) return;

  // Cheap pre-check against the mirrored schema file: in steady state every
  // option already exists and no MCP call happens at all.
  const schema = await loadFolderSchema(
    root,
    REFERENCES_COLLECTION_NAME,
    REFERENCE_LABELS,
  );
  const missingOnDisk = [...demand].some(([fieldId, labels]) => {
    const existing = schema.choiceLabels(fieldId);
    return [...labels].some((label) => !existing.has(label.toLowerCase()));
  });
  if (!missingOnDisk) return;

  // Authoritative read-modify-write over MCP (fetched fresh immediately
  // before the write so we can't clobber concurrent schema changes).
  const guid = await client.findCollectionGuid(REFERENCES_COLLECTION_NAME);
  if (!guid) {
    throw new ThymerMcpError(
      'list_collections',
      null,
      `collection ${REFERENCES_COLLECTION_NAME} not found`,
    );
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const config = (await client.getCollectionConfigJson(guid)) as {
    fields?: ConfigField[];
  };
  if (spliceMissingOptions(config.fields ?? [], demand)) {
    await client.updateCollectionConfigJson(guid, config);
  }
}

function collectDemand(blobs: DesiredState[]): Demand {
  const demand: Demand = new Map(CHOICE_FIELD_IDS.map((id) => [id, new Set()]));
  const add = (fieldId: string, value: string | number | undefined): void => {
    if (typeof value === 'string' && value) demand.get(fieldId)?.add(value);
  };

  for (const blob of blobs) {
    add('itemType', blob.scalars.itemType);
    add('container', blob.scalars.container);
    for (const tag of blob.tags) add('tags', tag);
    for (const name of blob.collections) add('collections', name);
  }
  return demand;
}

/** Append missing options in place; true when anything was added. */
function spliceMissingOptions(fields: ConfigField[], demand: Demand): boolean {
  let changed = false;

  for (const [fieldId, labels] of demand) {
    const field = fields.find((candidate) => candidate.id === fieldId);
    if (!field || !labels.size) continue;
    field.choices ??= [];

    const existingLabels = new Set(
      field.choices.map((choice) => choice.label.toLowerCase()),
    );
    const existingIds = new Set(field.choices.map((choice) => choice.id));

    for (const label of labels) {
      if (existingLabels.has(label.toLowerCase())) continue;
      const id = uniqueChoiceId(label, existingIds);
      existingIds.add(id);
      existingLabels.add(label.toLowerCase());
      field.choices.push({ id, label, icon: '', active: true, color: '' });
      changed = true;
    }
  }
  return changed;
}

/** Kebab-case option id (same normalization as the reconciler's choice()). */
function uniqueChoiceId(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'choice';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
