import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, ImagePlus, X, Trash2, Image } from 'lucide-react';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
const ALLOWED_MIME_PREFIX = 'image/';

interface PhotoInputProps {
  files: File[];
  previewUrls: string[];
  disabled?: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onOpenCamera?: () => void;
}

export const PhotoInput: React.FC<PhotoInputProps> = ({
  files,
  previewUrls,
  disabled = false,
  onAdd,
  onRemove,
  onClear,
  onOpenCamera,
}) => {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0) {
      // Reset input value so the same file can be re-selected on iOS
      event.target.value = '';
      return;
    }

    const nextFiles: File[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      // iOS Safari may report empty type for HEIC images — validate by extension too
      const isImageByMime = file.type && file.type.startsWith(ALLOWED_MIME_PREFIX);
      const isImageByExt = ALLOWED_EXTENSIONS.test(file.name);
      if (!isImageByMime && !isImageByExt) continue;
      if (file.size > MAX_FILE_SIZE) continue;
      nextFiles.push(file);
    }

    // Must reset AFTER reading files, otherwise iOS won't re-fire onChange
    event.target.value = '';

    if (nextFiles.length > 0) {
      onAdd(nextFiles);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm shrink-0"
            style={{
              background: 'linear-gradient(135deg, #667eea, #764ba2)',
              boxShadow: '0 2px 12px rgba(102,126,234,0.3)',
            }}>
            <Camera size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-text-primary">拍照签到</h3>
            <p className="text-[10px] text-text-muted font-medium mt-0.5 truncate">
              {files.length > 0
                ? `已选择 ${files.length} 张照片`
                : '支持相册上传或全屏拍摄'}
            </p>
          </div>
        </div>

        {files.length > 0 && (
          <button
            onClick={onClear}
            disabled={disabled}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-90"
            style={{
              color: '#F53F3F',
              background: 'rgba(245,63,63,0.08)',
            }}
          >
            <Trash2 size={12} />
            清空
          </button>
        )}
      </div>

      {/* Photo grid */}
      <AnimatePresence mode="popLayout">
        {previewUrls.length > 0 ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {previewUrls.map((url, index) => (
                <motion.div
                  key={url}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85, pointerEvents: "none" }}
                  style={{ borderColor: 'rgba(226,232,240,0.5)' }}
                >
                  <img
                    src={url}
                    alt={`照片 ${index + 1}`}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-200" />

                  {/* Photo index badge */}
                  <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold backdrop-blur-md"
                    style={{
                      background: 'rgba(0,0,0,0.4)',
                      color: 'rgba(255,255,255,0.9)',
                    }}>
                    #{index + 1}
                  </div>

                  {/* Remove button */}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemove(index)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 active:scale-90"
                    style={{
                      background: 'rgba(239,68,68,0.85)',
                      backdropFilter: 'blur(8px)',
                    }}
                    title="移除照片"
                  >
                    <X size={11} className="text-white" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative overflow-hidden rounded-2xl border-2 border-dashed py-8 text-center"
            style={{
              borderColor: 'rgba(226,232,240,0.6)',
              background: 'linear-gradient(135deg, rgba(248,250,252,0.5), rgba(241,245,249,0.3))',
            }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
              style={{
                background: 'linear-gradient(135deg, rgba(102,126,234,0.1), rgba(118,75,162,0.08))',
              }}>
              <Image size={24} className="text-slate-300" />
            </div>
            <p className="text-xs font-bold text-text-muted">尚未添加签到照片</p>
            <p className="text-[10px] text-slate-400 mt-1">拍照或从相册选择后自动分配</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          
          type="button"
          disabled={disabled}
          onClick={() => galleryInputRef.current?.click()}
          className="relative py-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 overflow-hidden group"
          style={{
            background: 'rgba(241,245,249,0.8)',
            color: '#64748B',
            border: '1px solid rgba(226,232,240,0.5)',
          }}
        >
          <ImagePlus size={16} />
          <span>从相册选择</span>
        </button>

        <button
          
          type="button"
          disabled={disabled}
          onClick={onOpenCamera}
          className="relative py-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 overflow-hidden group shadow-sm"
          style={{
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(102,126,234,0.3)',
          }}
        >
          <Camera size={16} />
          <span>进入相机拍摄</span>
        </button>
      </div>

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/heic,image/heif"
        multiple
        className="hidden"
        onChange={handleChange}
        // iOS Safari: when input is inside a label/button click chain,
        // ensure the file picker opens correctly by allowing user interaction
        onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
      />
    </motion.div>
  );
};
