/**
 * photoTransfer: 用于在 FullPhoto 和 SignDetail 之间传递照片 File 对象。
 *
 * 使用 sessionStorage + base64 方案替代模块级变量。
 * 模块级变量在 Vite HMR（热更新）时会被重置，导致照片数据丢失。
 * sessionStorage 在浏览器标签页生命周期内持久存在，不受 HMR 影响。
 */

const STORAGE_KEY = 'xbt_pending_photos';

interface StoredPhoto {
  name: string;
  type: string;
  size: number;
  data: string; // base64 data URL
}

export async function storePhotos(files: File[]): Promise<void> {
  const photoData: StoredPhoto[] = await Promise.all(
    files.map(async (file) => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      return {
        name: file.name,
        type: file.type,
        size: file.size,
        data,
      };
    })
  );

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(photoData));
  } catch (err) {
    console.error('photoTransfer: sessionStorage 存储失败', err);
  }
}

export function takePhotos(): File[] | null {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  sessionStorage.removeItem(STORAGE_KEY);

  try {
    const photoData: StoredPhoto[] = JSON.parse(stored);
    return photoData.map((p) => {
      const arr = p.data.split(',');
      const mimeMatch = arr[0]?.match(/:(.*?);/);
      const mime = mimeMatch?.[1] || p.type || 'image/jpeg';
      const bstr = atob(arr[1] || '');
      const n = bstr.length;
      const u8arr = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        u8arr[i] = bstr.charCodeAt(i);
      }
      return new File([u8arr], p.name || 'photo.jpg', { type: mime });
    });
  } catch (err) {
    console.error('photoTransfer: 解析照片数据失败', err);
    return null;
  }
}

export function clearStoredPhotos(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
