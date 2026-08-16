import { describe, expect, it, vi } from 'vitest';
import { printPdf, reportRequest, shareOrDownloadPdf } from './reportSharing.js';

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
});
