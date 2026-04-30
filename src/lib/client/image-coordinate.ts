export interface FrameSize {
  width: number;
  height: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedBox extends NormalizedPoint {
  width: number;
  height: number;
}

export interface ProjectedPoint {
  left: number;
  top: number;
}

export interface ProjectedBox extends ProjectedPoint {
  width: number;
  height: number;
}

function isValidFrame(frame: FrameSize) {
  return (
    Number.isFinite(frame.width) &&
    Number.isFinite(frame.height) &&
    frame.width > 0 &&
    frame.height > 0
  );
}

function isValidAspectRatio(imageAspectRatio: number) {
  return Number.isFinite(imageAspectRatio) && imageAspectRatio > 0;
}

export function resolveContainedImageRect(
  frame: FrameSize,
  imageAspectRatio: number,
) {
  if (!isValidFrame(frame) || !isValidAspectRatio(imageAspectRatio)) {
    return null;
  }

  const frameAspectRatio = frame.width / frame.height;
  const width =
    frameAspectRatio > imageAspectRatio
      ? frame.height * imageAspectRatio
      : frame.width;
  const height =
    frameAspectRatio > imageAspectRatio
      ? frame.height
      : frame.width / imageAspectRatio;

  return {
    left: (frame.width - width) / 2,
    top: (frame.height - height) / 2,
    width,
    height,
  };
}

export function mapContainedFramePointToImagePoint(params: {
  frame: FrameSize;
  imageAspectRatio: number;
  localX: number;
  localY: number;
}): NormalizedPoint | null {
  const imageRect = resolveContainedImageRect(
    params.frame,
    params.imageAspectRatio,
  );
  if (!imageRect) return null;

  const imageX = params.localX - imageRect.left;
  const imageY = params.localY - imageRect.top;

  if (
    imageX < 0 ||
    imageY < 0 ||
    imageX > imageRect.width ||
    imageY > imageRect.height
  ) {
    return null;
  }

  return {
    x: Math.min(1, Math.max(0, imageX / imageRect.width)),
    y: Math.min(1, Math.max(0, imageY / imageRect.height)),
  };
}

export function projectImagePointToContainedFrame(params: {
  frame: FrameSize;
  imageAspectRatio: number;
  point: NormalizedPoint;
}): ProjectedPoint | null {
  const imageRect = resolveContainedImageRect(
    params.frame,
    params.imageAspectRatio,
  );
  if (!imageRect) return null;

  return {
    left:
      ((imageRect.left + params.point.x * imageRect.width) /
        params.frame.width) *
      100,
    top:
      ((imageRect.top + params.point.y * imageRect.height) /
        params.frame.height) *
      100,
  };
}

export function projectImageBoxToContainedFrame(params: {
  frame: FrameSize;
  imageAspectRatio: number;
  box: NormalizedBox;
}): ProjectedBox | null {
  const imageRect = resolveContainedImageRect(
    params.frame,
    params.imageAspectRatio,
  );
  if (!imageRect) return null;

  return {
    left:
      ((imageRect.left + params.box.x * imageRect.width) /
        params.frame.width) *
      100,
    top:
      ((imageRect.top + params.box.y * imageRect.height) /
        params.frame.height) *
      100,
    width: (params.box.width * imageRect.width * 100) / params.frame.width,
    height: (params.box.height * imageRect.height * 100) / params.frame.height,
  };
}
