import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCanvasAsPng, readImageAsDataUrl } from './file-io';

const RAW_DATA_URL = 'data:image/png;base64,raw-image';
const JPEG_DATA_URL = 'data:image/jpeg;base64,resized-image';

type ReaderEvent = 'load' | 'error' | 'abort';

type ReaderStub = {
  result: unknown;
  error: Error | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  readAsDataURL: ReturnType<typeof vi.fn>;
};

function installReader(event: ReaderEvent = 'load', result: unknown = RAW_DATA_URL, error: Error | null = null): ReaderStub {
  let reader!: ReaderStub;
  reader = {
    result,
    error,
    onload: null,
    onerror: null,
    onabort: null,
    readAsDataURL: vi.fn(() => {
      if (event === 'load') reader.onload?.();
      if (event === 'error') reader.onerror?.();
      if (event === 'abort') reader.onabort?.();
    }),
  };
  vi.stubGlobal('FileReader', vi.fn(function TestFileReader() { return reader; }));
  return reader;
}

type ImageEvent = 'load' | 'error';

type ImageStub = {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
};

function installImage(options: {
  event?: ImageEvent;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  deferEvent?: boolean;
} = {}): ImageStub {
  const {
    event = 'load',
    width = 1200,
    height = 900,
    naturalWidth = width,
    naturalHeight = height,
    deferEvent = false,
  } = options;
  let source = '';
  const image = {
    width,
    height,
    naturalWidth,
    naturalHeight,
    onload: null,
    onerror: null,
  } as ImageStub;
  Object.defineProperty(image, 'src', {
    configurable: true,
    get: () => source,
    set: (value: string) => {
      source = value;
      const dispatch = () => {
        // Keep callback exceptions from escaping the fake browser event loop.
        // A buggy implementation then leaves its promise pending, which the
        // bounded rejection helper below reports as a hang.
        try {
          if (event === 'load') image.onload?.();
          if (event === 'error') image.onerror?.();
        } catch {
          // Intentionally swallowed to observe whether the implementation
          // rejects its own promise when an image event handler fails.
        }
      };
      if (deferEvent) queueMicrotask(dispatch);
      else dispatch();
    },
  });
  vi.stubGlobal('Image', vi.fn(function TestImage() { return image; }));
  return image;
}

function imageFile(): File {
  return new File(['image-bytes'], 'plan.png', { type: 'image/png' });
}

type CanvasContextStub = {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

type CanvasStub = {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  toDataURL: ReturnType<typeof vi.fn>;
};

function installImageCanvas(context: CanvasContextStub | null, toDataUrl: () => string = () => JPEG_DATA_URL): CanvasStub {
  const canvas: CanvasStub = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(toDataUrl),
  };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  return canvas;
}

async function expectRejectsWithoutHanging(promise: Promise<unknown>, label: string): Promise<void> {
  const outcome = await Promise.race([
    promise.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    ),
    new Promise<{ status: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ status: 'timeout' }), 150);
    }),
  ]);
  expect(outcome.status, label).toBe('rejected');
  if (outcome.status === 'rejected') expect(outcome.error).toBeInstanceOf(Error);
}

async function waitForTimer(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('downloadCanvasAsPng', () => {
  function canvasWithBlob(observer?: (blob: Blob) => void): HTMLCanvasElement {
    return {
      toBlob: vi.fn((callback: BlobCallback) => {
        const blob = new Blob(['png-bytes'], { type: 'image/png' });
        observer?.(blob);
        callback(blob);
      }),
    } as unknown as HTMLCanvasElement;
  }

  it('downloads a PNG and revokes the generated URL after the click dispatch', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:png-download');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.fn();
    const link = { href: '', download: '', click };
    vi.stubGlobal('document', { createElement: vi.fn(() => link) });

    const canvas = canvasWithBlob((blob) => {
      expect(blob).toBeInstanceOf(Blob);
    });
    await expect(downloadCanvasAsPng(canvas, '现场截图')).resolves.toBe(true);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(link.href).toBe('blob:png-download');
    expect(link.download).toBe('现场截图.png');
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await waitForTimer();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:png-download');
  });

  it('returns false when the encoder supplies no blob', async () => {
    const toBlob = vi.fn((callback: BlobCallback) => callback(null));
    const canvas = { toBlob } as unknown as HTMLCanvasElement;
    await expect(downloadCanvasAsPng(canvas, 'empty')).resolves.toBe(false);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });

  it('settles false when toBlob throws synchronously', async () => {
    const canvas = { toBlob: vi.fn(() => { throw new Error('encode failed'); }) } as unknown as HTMLCanvasElement;
    await expect(downloadCanvasAsPng(canvas, 'throws')).resolves.toBe(false);
  });

  it('settles after an asynchronous toBlob callback', async () => {
    const blob = new Blob(['png-bytes'], { type: 'image/png' });
    const canvas = {
      toBlob: vi.fn((callback: BlobCallback) => {
        queueMicrotask(() => callback(blob));
      }),
    } as unknown as HTMLCanvasElement;
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:async-download');
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ href: '', download: '', click: vi.fn() })) });

    const result = downloadCanvasAsPng(canvas, 'async');
    await expect(result).resolves.toBe(true);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await waitForTimer();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:async-download');
  });

  it('returns false when an asynchronous callback hits a download error and still defers revoke', async () => {
    const blob = new Blob(['png-bytes'], { type: 'image/png' });
    const canvas = {
      toBlob: vi.fn((callback: BlobCallback) => {
        queueMicrotask(() => callback(blob));
      }),
    } as unknown as HTMLCanvasElement;
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:async-failure');
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click: vi.fn(() => { throw new Error('async click failed'); }),
      })),
    });

    await expect(downloadCanvasAsPng(canvas, 'async-failure')).resolves.toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await waitForTimer();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:async-failure');
  });

  it.each([
    ['URL.createObjectURL', () => {
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('URL failed'); });
      vi.stubGlobal('document', { createElement: vi.fn() });
    }],
    ['document.createElement', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:create-link');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.stubGlobal('document', { createElement: vi.fn(() => { throw new Error('DOM failed'); }) });
    }],
    ['link.click', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:click-link');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.stubGlobal('document', { createElement: vi.fn(() => ({ href: '', download: '', click: vi.fn(() => { throw new Error('click failed'); }) })) });
    }],
  ])('settles false when %s throws', async (_failure, installFailure) => {
    installFailure();
    const canvas = canvasWithBlob(() => {});
    await expect(downloadCanvasAsPng(canvas, 'failure')).resolves.toBe(false);
  });
});

describe('readImageAsDataUrl', () => {
  it('keeps a small image as the original data URL', async () => {
    installReader();
    installImage({ width: 1200, height: 900, naturalWidth: 1200, naturalHeight: 900 });
    await expect(readImageAsDataUrl(imageFile())).resolves.toBe(RAW_DATA_URL);
  });

  it('downscales a large image onto white and encodes JPEG at quality 0.85', async () => {
    installReader();
    const image = installImage({ width: 1000, height: 800, naturalWidth: 3000, naturalHeight: 2000 });
    const context: CanvasContextStub = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const canvas = installImageCanvas(context);

    await expect(readImageAsDataUrl(imageFile())).resolves.toBe(JPEG_DATA_URL);
    expect(context.fillStyle).toBe('#ffffff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1500, 1000);
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 1500, 1000);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
  });

  it('keeps a one-pixel short edge when scaling a very narrow image', async () => {
    installReader();
    installImage({ width: 3000, height: 1, naturalWidth: 3000, naturalHeight: 1 });
    const context: CanvasContextStub = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    installImageCanvas(context);

    await expect(readImageAsDataUrl(imageFile())).resolves.toBe(JPEG_DATA_URL);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1500, 1);
  });

  it.each([
    ['invalid image dimensions', () => {
      installImage({ width: 1000, height: 800, naturalWidth: Number.NaN, naturalHeight: 800 });
    }],
    ['missing 2D context', () => {
      installImage({ width: 3000, height: 2000, naturalWidth: 3000, naturalHeight: 2000 });
      installImageCanvas(null);
    }],
    ['image decode failure', () => {
      installImage({ event: 'error' });
    }],
    ['drawImage failure', () => {
      installImage({ width: 3000, height: 2000, naturalWidth: 3000, naturalHeight: 2000, deferEvent: true });
      const context: CanvasContextStub = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(() => { throw new Error('draw failed'); }) };
      installImageCanvas(context);
    }],
    ['toDataURL failure', () => {
      installImage({ width: 3000, height: 2000, naturalWidth: 3000, naturalHeight: 2000, deferEvent: true });
      const context: CanvasContextStub = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
      installImageCanvas(context, () => { throw new Error('encode failed'); });
    }],
  ])('rejects on %s without hanging', async (_failure, installFailure) => {
    installReader();
    installFailure();
    await expectRejectsWithoutHanging(readImageAsDataUrl(imageFile()), String(_failure));
  });

  it.each([
    ['abort', () => installReader('abort')],
    ['reader error', () => installReader('error', null, new Error('read failed'))],
    ['non-string result', () => installReader('load', 42)],
    ['empty result', () => installReader('load', '')],
  ])('rejects on FileReader %s without hanging', async (_failure, installFailure) => {
    installFailure();
    installImage();
    await expectRejectsWithoutHanging(readImageAsDataUrl(imageFile()), String(_failure));
  });
});
