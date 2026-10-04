import { createRef } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SourceLoaders from '../../src/components/SourceLoaders.jsx';
import ChoicePanel from '../../src/components/ChoicePanel.jsx';
import ErrorPanel from '../../src/components/ErrorPanel.jsx';
import FindBar from '../../src/components/FindBar.jsx';
import { text } from './support.js';

function renderLoaders(props = {}) {
  const handlers = { onFilesChosen: vi.fn(), onDatabaseUrlChange: vi.fn(), onFetchSubmit: vi.fn((event) => event.preventDefault()), onBrowseCatalog: vi.fn() };
  const fileInputRef = createRef();
  render(
    <SourceLoaders
      dropzone={{ isDragActive: false, isDropPulseActive: false, dropzoneProps: {} }}
      fileInputRef={fileInputRef}
      databaseUrl=""
      catalogReady
      catalogCount={165}
      catalogStatus="ready"
      catalogError=""
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, fileInputRef, user: userEvent.setup() };
}

describe('the ways to open a database', () => {
  test('uploads take one or several chosen files, and folders only by dropping', async () => {
    const { user, fileInputRef, onFilesChosen } = renderLoaders();
    const input = document.querySelector('#database-file-input');
    expect(input.multiple).toBe(true);
    expect(document.querySelector('input[webkitdirectory]')).toBeNull();
    expect(screen.queryByRole('button', { name: /choose a folder/i })).toBeNull();
    expect(text(document.querySelector('.dropzone'))).toContain('Drop several files or whole folders to choose among their databases.');

    // The button chooses files, and so does a click on the area that takes drops.
    const clicked = vi.spyOn(fileInputRef.current, 'click');
    await user.click(screen.getByRole('button', { name: 'Choose files' }));
    expect(clicked).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText('Drop files or folders here'));
    expect(clicked).toHaveBeenCalledTimes(2);

    const files = [new File(['{}'], 'a.json'), new File(['{}'], 'b.json')];
    await user.upload(input, files);
    expect(onFilesChosen).toHaveBeenCalledWith(files);
    // The input is emptied, so the same files can be chosen again.
    expect(input.value).toBe('');
  });

  test('Fetch takes the URL typed in its box', async () => {
    const { user, onDatabaseUrlChange, onFetchSubmit } = renderLoaders({ databaseUrl: 'https://example.com/db.json' });
    expect(screen.getByLabelText('URL').value).toBe('https://example.com/db.json');
    await user.type(screen.getByLabelText('URL'), '!');
    expect(onDatabaseUrlChange).toHaveBeenLastCalledWith('https://example.com/db.json!');
    await user.click(screen.getByRole('button', { name: 'Fetch database' }));
    expect(onFetchSubmit).toHaveBeenCalledTimes(1);
  });

  test('the catalog says how many entries it has, or that it is unavailable', async () => {
    const { user, onBrowseCatalog } = renderLoaders();
    expect(screen.getByText('165 entries available')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Browse catalog' }));
    expect(onBrowseCatalog).toHaveBeenCalledTimes(1);
  });

  test('a catalog that failed to load cannot be browsed', () => {
    renderLoaders({ catalogReady: false, catalogStatus: 'error', catalogError: 'Request failed.' });
    expect(screen.getByRole('button', { name: 'Browse catalog' }).disabled).toBe(true);
    expect(screen.getByText('Catalog unavailable')).toBeTruthy();
    expect(screen.getByText('Request failed.')).toBeTruthy();
  });

  test('a list or upload waiting to be chosen from can be browsed again', async () => {
    const onBrowseEntries = vi.fn();
    render(<ChoicePanel choice={{ panelLabel: 'Database List', description: 'https://example.com/list.ini contains 2 entries.' }} onBrowseEntries={onBrowseEntries} />);
    expect(screen.getByText('https://example.com/list.ini contains 2 entries. Choose the ones you want to open.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Browse entries' }));
    expect(onBrowseEntries).toHaveBeenCalledTimes(1);
  });
});

describe('what went wrong opening a source', () => {
  const RELEASE_URL = 'https://github.com/giancarloerra/Degauss/releases/latest/download/degauss.json.zip';

  test('a GitHub release download the page cannot read gets a link to download it', () => {
    const message = `GitHub does not let websites read release downloads, so ${RELEASE_URL} cannot be opened in the browser. Download degauss.json.zip and drag it into Upload to inspect it.`;
    render(<ErrorPanel message={message} />);

    expect(text(document.querySelector('.status.error'))).toBe(message);
    const link = screen.getByRole('link', { name: 'Download degauss.json.zip' });
    expect(link.getAttribute('href')).toBe(RELEASE_URL);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  test('other errors only say what went wrong', () => {
    render(<ErrorPanel message="Could not open https://example.com/db.json in the browser. The website may block direct access or be temporarily unavailable." />);
    expect(text(document.querySelector('.status.error'))).toContain('Could not open https://example.com/db.json');
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('the find bar', () => {
  function renderFindBar(props = {}) {
    const handlers = { onQueryChange: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onJumpTo: vi.fn(), onClose: vi.fn() };
    render(<FindBar query="ess" focusToken={1} currentIndex={0} totalMatches={3} {...handlers} {...props} />);
    return { ...handlers, user: userEvent.setup(), input: screen.getByLabelText('Search text') };
  }

  test('counts the matches and moves through them with Enter, Shift+Enter and its buttons', async () => {
    const { user, input, onNext, onPrev, onQueryChange } = renderFindBar();
    expect(screen.getByRole('search', { name: 'Find in tree' })).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(text(document.querySelector('.find-bar-count'))).toBe('1 of 3');

    await user.keyboard('{Enter}');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Next match' }));
    await user.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrev).toHaveBeenCalledTimes(2);

    await user.type(input, 'e');
    expect(onQueryChange).toHaveBeenLastCalledWith('esse');
  });

  test('Escape and the close button close it', async () => {
    const { user, onClose } = renderFindBar();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Close search' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('the count can be edited to jump to a match', async () => {
    const { user, onJumpTo } = renderFindBar();
    await user.click(document.querySelector('.find-bar-count'));
    const jump = await screen.findByLabelText('Jump to match number');
    fireEvent.change(jump, { target: { value: '3' } });
    fireEvent.keyDown(jump, { key: 'Enter' });
    expect(onJumpTo).toHaveBeenCalledWith(3);
  });

  test('without matches, the count shows none and the arrows are off', () => {
    renderFindBar({ totalMatches: 0 });
    expect(text(document.querySelector('.find-bar-count'))).toBe('0 of 0');
    expect(screen.getByRole('button', { name: 'Next match' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Previous match' }).disabled).toBe(true);
  });
});
