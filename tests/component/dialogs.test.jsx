import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import LoadModeModal from '../../src/components/modals/LoadModeModal.jsx';
import ReplaceLoadedModal from '../../src/components/modals/ReplaceLoadedModal.jsx';
import FilterOverrideModal from '../../src/components/modals/FilterOverrideModal.jsx';
import DbIdConflictModal from '../../src/components/modals/DbIdConflictModal.jsx';
import { inspect, text } from './support.js';

describe('the question before combining', () => {
  test('names the loaded databases and how many would replace them, and each button answers', async () => {
    const answers = { onLoadAlone: vi.fn(), onCombine: vi.fn(), onCancel: vi.fn() };
    render(<LoadModeModal loadedDbIds={['alpha', 'beta']} incomingCount={4} {...answers} />);
    const dialog = screen.getByRole('dialog', { name: 'Combine with the loaded databases?' });

    expect(text(dialog)).toContain('These databases are already loaded: alpha, beta.');
    expect(text(dialog)).toContain('Load the 4 selected databases alone to replace them');
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: 'Load alone' }));
    await user.click(within(dialog).getByRole('button', { name: 'Combine' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(answers.onLoadAlone).toHaveBeenCalledTimes(1);
    expect(answers.onCombine).toHaveBeenCalledTimes(1);
    expect(answers.onCancel).toHaveBeenCalledTimes(1);
  });

  test('speaks of one database for one', () => {
    render(<LoadModeModal loadedDbIds={['alpha']} onLoadAlone={() => {}} onCombine={() => {}} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Combine with the loaded databases?' });
    expect(text(dialog)).toContain('This database is already loaded: alpha.');
    expect(text(dialog)).toContain('Load the new database alone to replace it');
  });

  test('a click outside cancels', async () => {
    const onCancel = vi.fn();
    render(<LoadModeModal loadedDbIds={['alpha']} onLoadAlone={() => {}} onCombine={() => {}} onCancel={onCancel} />);
    await userEvent.setup().click(document.querySelector('.modal-overlay'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('the question about a loaded db_id', () => {
  async function conflict(dbId, loadedUrl, incomingName) {
    const loaded = { inspection: { ...(await inspect({ db_id: dbId, v: 1, timestamp: 1, files: {}, folders: {} })), source: { sourceKind: 'url', sourceLabel: loadedUrl } } };
    const incoming = { inspection: await inspect({ db_id: dbId, v: 1, timestamp: 2, files: {}, folders: {} }, incomingName) };
    return { dbId, loaded, incoming };
  }

  test('about one database: keep the loaded one, or replace it', async () => {
    const onAnswer = vi.fn();
    render(<ReplaceLoadedModal conflicts={[await conflict('alpha', 'https://example.com/alpha.json', 'twin.json')]} onAnswer={onAnswer} />);
    const dialog = screen.getByRole('dialog', { name: 'Replace the loaded database?' });

    expect(text(dialog)).toContain('A database with the db_id alpha is already loaded.');
    expect(text(dialog.querySelector('.filter-override-grid'))).toBe('Loadedhttps://example.com/alpha.jsonNewUploaded: twin.json');
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: 'Keep the loaded one' }));
    expect(onAnswer).toHaveBeenLastCalledWith(new Set());
    await user.click(within(dialog).getByRole('button', { name: 'Replace it' }));
    expect(onAnswer).toHaveBeenLastCalledWith(new Set(['alpha']));
  });

  test('about the loaded database again, from its URL: keep it, or reload it', async () => {
    const onAnswer = vi.fn();
    const url = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/db/update_all_db.json';
    const again = { ...(await conflict('update_all_mister', url, 'unused.json')), reload: true };
    render(<ReplaceLoadedModal conflicts={[again]} onAnswer={onAnswer} />);
    const dialog = screen.getByRole('dialog', { name: 'Reload the loaded database?' });

    expect(text(dialog)).toContain(
      'The database update_all_mister is already loaded from this URL. Reloading it replaces the loaded copy with the one just fetched.',
    );
    expect(text(dialog.querySelector('.filter-override-grid'))).toBe(`URL${url}`);
    expect(within(dialog).queryByRole('button', { name: 'Replace it' })).toBeNull();
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: 'Keep the loaded one' }));
    expect(onAnswer).toHaveBeenLastCalledWith(new Set());
    await user.click(within(dialog).getByRole('button', { name: 'Reload it' }));
    expect(onAnswer).toHaveBeenLastCalledWith(new Set(['update_all_mister']));
    await user.click(document.querySelector('.modal-overlay'));
    expect(onAnswer).toHaveBeenLastCalledWith(new Set());
  });

  test('about one database, a click outside keeps the loaded one', async () => {
    const onAnswer = vi.fn();
    render(<ReplaceLoadedModal conflicts={[await conflict('alpha', 'https://example.com/alpha.json', 'twin.json')]} onAnswer={onAnswer} />);
    await userEvent.setup().click(document.querySelector('.modal-overlay'));
    expect(onAnswer).toHaveBeenCalledWith(new Set());
  });

  test('about several: each starts checked, Continue replaces the checked ones, and Cancel changes nothing', async () => {
    const onAnswer = vi.fn();
    const conflicts = [
      await conflict('alpha', 'https://example.com/alpha.json', 'a.json'),
      await conflict('beta', 'https://example.com/beta.json', 'b.json'),
    ];
    render(<ReplaceLoadedModal conflicts={conflicts} onAnswer={onAnswer} />);
    const dialog = screen.getByRole('dialog', { name: 'Replace loaded databases?' });

    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(text(dialog)).toContain('Loaded: https://example.com/beta.json');
    expect(text(dialog)).toContain('New: Uploaded: b.json');

    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Replace beta' }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(onAnswer).toHaveBeenLastCalledWith(new Set(['alpha']));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onAnswer).toHaveBeenLastCalledWith(null);
  });
});

describe('the question before replacing FILTER', () => {
  test('shows both filters, and replaces or keeps the current one', async () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<FilterOverrideModal currentFilter="manual  !keep" nextFilter="arcade ini-list-default" onAccept={onAccept} onDecline={onDecline} />);
    const dialog = screen.getByRole('dialog', { name: 'Replace the current filter?' });

    expect(text(dialog.querySelector('.filter-override-grid'))).toBe('Current FILTERmanual !keepIncoming FILTERarcade ini-list-default');
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: 'Replace filter' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Keep current' }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });
});

describe('the question about a selected db_id', () => {
  test('names the db_id and both databases, and replaces or cancels', async () => {
    const onReplace = vi.fn();
    const onCancel = vi.fn();
    const selected = { dbId: 'distribution_mister', title: 'Main Distribution', dbUrl: 'https://example.com/main.zip' };
    const incoming = { dbId: 'distribution_mister', title: 'Edge Linux', dbUrl: 'https://example.com/edge.zip' };
    render(<DbIdConflictModal selected={selected} incoming={incoming} onReplace={onReplace} onCancel={onCancel} />);
    const dialog = screen.getByRole('dialog', { name: 'Replace the selected database?' });

    expect(text(dialog)).toContain('Another selected database has the db_id distribution_mister.');
    expect(text(dialog.querySelector('.filter-override-grid'))).toBe('SelectedMain Distributionhttps://example.com/main.zipReplace withEdge Linuxhttps://example.com/edge.zip');
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: 'Replace' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
