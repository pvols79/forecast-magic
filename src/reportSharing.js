export const reportRequest = (accountKey, view) => ({
  accountKey,
  view: view === 'admin' ? 'admin' : 'household',
});

export const shareOrDownloadPdf = async ({ blob, filename }, environment = {}) => {
  const navigatorObject = environment.navigatorObject || globalThis.navigator;
  const documentObject = environment.documentObject || globalThis.document;
  const urlObject = environment.urlObject || globalThis.URL;
  const file = new File([blob], filename, { type: 'application/pdf' });

  if (navigatorObject?.share && navigatorObject.canShare?.({ files: [file] })) {
    await navigatorObject.share({
      title: 'Forecast Magic Daily Financial Highlight',
      text: 'Current Forecast Magic financial report',
      files: [file],
    });
    return 'shared';
  }

  const url = urlObject.createObjectURL(blob);
  const link = documentObject.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  documentObject.body.appendChild(link);
  link.click();
  link.remove();
  urlObject.revokeObjectURL(url);
  return 'downloaded';
};

export const printPdf = ({ blob, filename }, environment = {}) => new Promise((resolve, reject) => {
  const documentObject = environment.documentObject || globalThis.document;
  const urlObject = environment.urlObject || globalThis.URL;
  const schedule = environment.schedule || globalThis.setTimeout;
  const url = urlObject.createObjectURL(blob);
  const frame = documentObject.createElement('iframe');
  frame.title = `Print ${filename}`;
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';

  const cleanup = () => {
    frame.remove();
    urlObject.revokeObjectURL(url);
  };
  frame.onerror = () => {
    cleanup();
    reject(new Error('Unable to prepare the report for printing.'));
  };
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      schedule(cleanup, 1000);
      resolve('printing');
    } catch (error) {
      cleanup();
      reject(error);
    }
  };
  frame.src = url;
  documentObject.body.appendChild(frame);
});
