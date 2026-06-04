import React, { useRef } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';

interface PhotoInputProps {
  files: File[];
  previewUrls: string[];
  disabled?: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}

export const PhotoInput: React.FC<PhotoInputProps> = ({
  files,
  previewUrls,
  disabled = false,
  onAdd,
  onRemove,
  onClear,
}) => {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (nextFiles.length > 0) {
      onAdd(nextFiles);
    }
  };

  return (
    <div className="w-full space-y-4 py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest">拍照签到</h3>
          <p className="text-[10px] text-slate-400 font-medium mt-1 truncate">
            {files.length > 0 ? `已选择 ${files.length} 张照片` : '可拍照或选择多张照片'}
          </p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 shadow-inner">
          <Camera size={24} />
        </div>
      </div>

      {previewUrls.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {previewUrls.map((url, index) => (
              <div key={url} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100 border border-slate-100">
                <img src={url} alt={`签到照片预览 ${index + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                  className="absolute right-1.5 top-1.5 w-7 h-7 rounded-full bg-slate-900/70 text-white flex items-center justify-center backdrop-blur-md disabled:opacity-50"
                  title="移除照片"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-bold disabled:opacity-50"
          >
            清空照片
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => galleryInputRef.current?.click()}
          className="w-full aspect-[4/3] rounded-2xl border-2 border-dashed border-blue-100 bg-blue-50/40 text-blue-600 flex flex-col items-center justify-center gap-3 active:scale-[0.99] transition-all disabled:opacity-50"
        >
          <ImagePlus size={36} />
          <span className="text-sm font-black">批量选择照片</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraInputRef.current?.click()}
          className="py-3 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-100 disabled:opacity-50 disabled:shadow-none"
        >
          <Camera size={16} />
          拍照添加
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => galleryInputRef.current?.click()}
          className="py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <ImagePlus size={16} />
          批量选择
        </button>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
};
