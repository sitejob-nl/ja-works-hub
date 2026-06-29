import type { DragEvent, DragEventHandler, InputHTMLAttributes } from 'react';

const FILE_DRAG_TYPE = 'Files';

export const isFileDragEvent = (event: DragEvent<HTMLElement>) =>
  Array.from(event.dataTransfer?.types ?? []).includes(FILE_DRAG_TYPE);

export const blockFileDrop = (event: DragEvent<HTMLElement>) => {
  if (!isFileDragEvent(event)) return;

  event.preventDefault();
  event.stopPropagation();
};

export const composeNoFileDropHandler =
  <T extends HTMLElement>(handler?: DragEventHandler<T>): DragEventHandler<T> =>
  (event) => {
    handler?.(event);
    if (!event.defaultPrevented) blockFileDrop(event);
  };

export const noFileDropInputProps = {
  onDragEnter: blockFileDrop,
  onDragOver: blockFileDrop,
  onDrop: blockFileDrop,
} satisfies Pick<InputHTMLAttributes<HTMLInputElement>, 'onDragEnter' | 'onDragOver' | 'onDrop'>;
