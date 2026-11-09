import { describe, expect, it, vi } from 'vitest';
import { downloadPdf, printPdf, reportRequest, shareOrDownloadPdf } from './reportSharing.js';

describe('report sharing', () => {
  it('uses the currently selected account and active report view', () => {
    expect(reportRequest('plaid:123', 'admin')).toEqual({ accountKey: 'plaid:123', view: 'admin' });
    expect(reportRequest('manual:7', 'household')).toEqual({ accountKey: 'manual:7', view: 'household' });
  });

  it('uses native file sharing when the browser supports it', async () => {
    const share = vi.fn(async () => {});
    const result = await shareOrDownloadPdf(
      { blob: new Blob(['pdf'], { type: 'application/pdf' }), filename: 'report.pdf' },
      { navigatorObject: { canShare: () => true, share } }
    );
    expect(result).toBe('shared');
    expect(share.mock.calls[0][0].files[0].name).toBe('report.pdf');
  });

  it('downloads when native file sharing is unavailable', async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const revokeObjectURL = vi.fn();
    const link = { click, remove };
    const result = await shareOrDownloadPdf(
      { blob: new Blob(['pdf'], { type: 'application/pdf' }), filename: 'report.pdf' },
      {
        navigatorObject: {},
        schedule: callback => callback(),
        documentObject: { createElement: () => link, body: { appendChild } },
        urlObject: { createObjectURL: () => 'blob:report', revokeObjectURL },
      }
    );
    expect(result).toBe('downloaded');
    expect(link).toMatchObject({ href: 'blob:report', download: 'report.pdf', rel: 'noopener' });
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it('opens the generated PDF in the browser print flow', async () => {
    const focus = vi.fn();
    const print = vi.fn();
    const remove = vi.fn();
    const revokeObjectURL = vi.fn();
    const frame = { style: {}, contentWindow: { focus, print }, remove };
    const appendChild = vi.fn(element => queueMicrotask(() => element.onload()));
    const result = await printPdf(
      { blob: new Blob(['pdf'], { type: 'application/pdf' }), filename: 'report.pdf' },
      {
        documentObject: { createElement: () => frame, body: { appendChild } },
        urlObject: { createObjectURL: () => 'blob:print-report', revokeObjectURL },
        schedule: callback => callback(),
      }
    );
    expect(result).toBe('printing');
    expect(frame).toMatchObject({ src: 'blob:print-report', title: 'Print report.pdf' });
    expect(focus).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:print-report');
  });
  it('opens the folder picker before fetching and saves without invoking share', async () => {
    const order = [];
    const blob = new Blob(['pdf'], { type: 'application/pdf' });
    const writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const share = vi.fn();
    const result = await downloadPdf({ filename: 'report.pdf', getFile: async () => {
      order.push('fetch'); return { blob, filename: 'report.pdf' };
    } }, { showSaveFilePicker: async options => {
      order.push('picker'); expect(options.suggestedName).toBe('report.pdf');
      return { createWritable: async () => writable };
    }, navigatorObject: { share, canShare: () => true } });
    expect(order).toEqual(['picker', 'fetch']);
    expect(result).toBe('saved');
    expect(writable.write).toHaveBeenCalledWith(blob);
    expect(writable.close).toHaveBeenCalledOnce();
    expect(share).not.toHaveBeenCalled();
  });

  it('does not fetch or download when the save picker is cancelled', async () => {
    const getFile = vi.fn();
    const error = Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    await expect(downloadPdf({ filename: 'report.pdf', getFile }, {
      showSaveFilePicker: async () => { throw error; },
    })).rejects.toBe(error);
    expect(getFile).not.toHaveBeenCalled();
  });

  it('aborts a failed save and preserves the write error', async () => {
    const error = new Error('Disk full');
    const writable = { write: vi.fn(async () => { throw error; }), abort: vi.fn(async () => {}), close: vi.fn() };
    await expect(downloadPdf({ filename: 'report.pdf', blob: new Blob(['pdf']) }, {
      showSaveFilePicker: async () => ({ createWritable: async () => writable }),
    })).rejects.toBe(error);
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
  });

});
