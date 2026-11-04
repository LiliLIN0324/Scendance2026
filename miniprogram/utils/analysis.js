/**
 * 采集快检 · 小程序侧实现。
 *
 * 对应 frontend/lib/capture-guide/image-analysis.ts：
 * 亮度直方图 + 8×8 感知哈希 + 重复判定；阈值全部来自 lib/thresholds.js。
 * 差异：小程序没有 createImageBitmap / HTMLCanvasElement，改用 wx.createOffscreenCanvas
 * 与 wx.getImageInfo；相机帧直接来自 CameraContext.onCameraFrame（ArrayBuffer）。
 */
const T = require('../lib/thresholds.js');

function lumaStatsFromRgba(rgba) {
  const pixelCount = Math.max(1, Math.floor(rgba.length / 4));
  let sum = 0;
  let bright = 0;
  let dark = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    const r = rgba[index] || 0;
    const g = rgba[index + 1] || 0;
    const b = rgba[index + 2] || 0;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += luma;
    if (luma >= T.exposure.brightPixel) bright += 1;
    if (luma <= T.exposure.darkPixel) dark += 1;
  }
  return {
    mean: Math.round((sum / pixelCount) * 10) / 10,
    brightRatio: Math.round((bright / pixelCount) * 1000) / 1000,
    darkRatio: Math.round((dark / pixelCount) * 1000) / 1000,
  };
}

function lumaStatsFromGray(gray) {
  const pixelCount = Math.max(1, gray.length);
  let sum = 0;
  let bright = 0;
  let dark = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const luma = gray[index] || 0;
    sum += luma;
    if (luma >= T.exposure.brightPixel) bright += 1;
    if (luma <= T.exposure.darkPixel) dark += 1;
  }
  return {
    mean: Math.round((sum / pixelCount) * 10) / 10,
    brightRatio: Math.round((bright / pixelCount) * 1000) / 1000,
    darkRatio: Math.round((dark / pixelCount) * 1000) / 1000,
  };
}

/** 64 个灰度值 → 16 位十六进制感知哈希。 */
function averageHashFromGray(gray) {
  if (gray.length < 64) return '0000000000000000';
  let sum = 0;
  for (let index = 0; index < 64; index += 1) sum += gray[index] || 0;
  const average = sum / 64;
  let hash = '';
  for (let nibble = 0; nibble < 16; nibble += 1) {
    let value = 0;
    for (let bit = 0; bit < 4; bit += 1) {
      if ((gray[nibble * 4 + bit] || 0) > average) value |= 1 << (3 - bit);
    }
    hash += value.toString(16);
  }
  return hash;
}

/** 64×64 灰度 → 8×8 块均值 → 16 位哈希（与网页端同一算法）。 */
function averageHashFromGrid(gray) {
  if (gray.length < 64 * 64) return '0000000000000000';
  const cells = [];
  for (let cellY = 0; cellY < 8; cellY += 1) {
    for (let cellX = 0; cellX < 8; cellX += 1) {
      let sum = 0;
      for (let y = 0; y < 8; y += 1) {
        const row = (cellY * 8 + y) * 64;
        for (let x = 0; x < 8; x += 1) sum += gray[row + cellX * 8 + x] || 0;
      }
      cells.push(sum / 64);
    }
  }
  return averageHashFromGray(cells);
}

/** RGBA 像素 → 64×64 灰度（最近邻抽样，避免极端缩小时采样不足）。 */
function gray64FromRgba(rgba, width, height) {
  const gray = new Array(64 * 64).fill(0);
  if (!width || !height) return gray;
  for (let y = 0; y < 64; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y * height) / 64));
    for (let x = 0; x < 64; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / 64));
      const offset = (sourceY * width + sourceX) * 4;
      const r = rgba[offset] || 0;
      const g = rgba[offset + 1] || 0;
      const b = rgba[offset + 2] || 0;
      gray[y * 64 + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }
  return gray;
}

/**
 * 4 邻域拉普拉斯方差（与网页端 image-analysis.ts 同一算法）。
 * 平坦图接近 0，纹理清晰的图通常远高于阈值；阈值见 T.blur.varianceMin。
 */
function laplacianVarianceFromGray(gray, width, height) {
  if (width < 3 || height < 3 || gray.length < width * height) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value =
        (gray[index - width] || 0) +
        (gray[index + width] || 0) +
        (gray[index - 1] || 0) +
        (gray[index + 1] || 0) -
        4 * (gray[index] || 0);
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.round((sumSq / count - mean * mean) * 10) / 10;
}

/**
 * RGBA 像素 → size×size 灰度，按区域均值降采样。
 * 相机帧是原始 RGBA，没有浏览器那种高质量 drawImage 缩放；
 * 用区域均值做低通，避免最近邻抽样把噪声当成纹理、把糊片算成清晰。
 */
function grayFromRgbaArea(rgba, width, height, size) {
  const gray = new Array(size * size).fill(0);
  if (!width || !height) return gray;
  const counts = new Array(size * size).fill(0);
  for (let y = 0; y < height; y += 1) {
    const targetY = Math.min(size - 1, Math.floor((y * size) / height));
    for (let x = 0; x < width; x += 1) {
      const targetX = Math.min(size - 1, Math.floor((x * size) / width));
      const offset = (y * width + x) * 4;
      const luma =
        0.2126 * (rgba[offset] || 0) + 0.7152 * (rgba[offset + 1] || 0) + 0.0722 * (rgba[offset + 2] || 0);
      const target = targetY * size + targetX;
      gray[target] += luma;
      counts[target] += 1;
    }
  }
  for (let index = 0; index < gray.length; index += 1) {
    if (counts[index] > 0) gray[index] = gray[index] / counts[index];
  }
  return gray;
}

/**
 * 相机帧（CameraContext.onCameraFrame 回调）→ 评分样本。
 * frame.data 是 RGBA 的 ArrayBuffer；分辨率/帧率取决于 frame-size，需真机实测。
 */
function frameFromCameraFrame(frame, meta) {
  const rgba = new Uint8ClampedArray(frame.data);
  const width = frame.width;
  const height = frame.height;
  const stats = lumaStatsFromRgba(rgba);
  const gray = gray64FromRgba(rgba, width, height);
  const blurSize = T.blur.size;
  const sharpGray = grayFromRgbaArea(rgba, width, height, blurSize);
  return {
    id: `cam-${meta.at}`,
    layer: meta.layer,
    width,
    height,
    meanLuma: stats.mean,
    brightRatio: stats.brightRatio,
    darkRatio: stats.darkRatio,
    hash: averageHashFromGrid(gray),
    sharpness: laplacianVarianceFromGray(sharpGray, blurSize, blurSize),
    heading: meta.heading,
    gps: meta.gps,
    at: meta.at,
  };
}

/** RGBA 像素 → 同尺寸灰度（画布已经做过高质量缩放，直接取即可）。 */
function grayFromRgba(rgba, size) {
  const gray = new Array(size * size).fill(0);
  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4;
    gray[index] =
      0.2126 * (rgba[offset] || 0) + 0.7152 * (rgba[offset + 1] || 0) + 0.0722 * (rgba[offset + 2] || 0);
  }
  return gray;
}

/**
 * 相册/拍照得到的临时文件 → 评分样本。
 * 64×64 离屏画布做统计与哈希，另一张 T.blur.size 画布算清晰度；
 * 缩略图直接复用临时文件路径。
 */
function analyseImagePath(path, meta) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: path,
      success(info) {
        const size = 64;
        const blurSize = T.blur.size;
        if (!wx.createOffscreenCanvas) {
          reject(new Error('当前基础库不支持离屏画布，请升级微信'));
          return;
        }
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: size, height: size });
        const context = canvas.getContext('2d');
        const blurCanvas = wx.createOffscreenCanvas({ type: '2d', width: blurSize, height: blurSize });
        const blurContext = blurCanvas.getContext('2d');
        const image = canvas.createImage();
        image.onload = () => {
          try {
            context.drawImage(image, 0, 0, size, size);
            const data = context.getImageData(0, 0, size, size).data;
            const gray = gray64FromRgba(data, size, size);
            const stats = lumaStatsFromGray(gray);
            blurContext.drawImage(image, 0, 0, blurSize, blurSize);
            const blurData = blurContext.getImageData(0, 0, blurSize, blurSize).data;
            const sharpGray = grayFromRgba(blurData, blurSize);
            resolve({
              id: `${path}-${meta.at}`,
              name: path.split('/').pop() || path,
              layer: meta.layer,
              width: info.width,
              height: info.height,
              meanLuma: stats.mean,
              brightRatio: stats.brightRatio,
              darkRatio: stats.darkRatio,
              hash: averageHashFromGrid(gray),
              sharpness: laplacianVarianceFromGray(sharpGray, blurSize, blurSize),
              heading: meta.heading,
              gps: meta.gps,
              at: meta.at,
              thumb: path,
            });
          } catch (error) {
            reject(error);
          }
        };
        image.onerror = () => reject(new Error('图片无法解码'));
        image.src = path;
      },
      fail(error) {
        reject(new Error(error && error.errMsg ? error.errMsg : '读取图片信息失败'));
      },
    });
  });
}

module.exports = {
  lumaStatsFromRgba,
  lumaStatsFromGray,
  averageHashFromGray,
  averageHashFromGrid,
  gray64FromRgba,
  frameFromCameraFrame,
  analyseImagePath,
};
