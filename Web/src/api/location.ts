import client from './client';

export interface LocationPreset {
  id: number;
  user_uid: number;
  name: string;
  lat: string;
  lng: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// 获取位置预设列表
export const getLocations = () => {
  return client.get<LocationPreset[]>('/locations');
};

// 新增位置预设
export const createLocation = (data: Partial<LocationPreset>) => {
  return client.post<LocationPreset>('/locations', data);
};

// 更新位置预设
export const updateLocation = (id: number, data: Partial<LocationPreset>) => {
  return client.put(`/locations/${id}`, data);
};

// 删除位置预设
export const deleteLocation = (id: number) => {
  return client.delete(`/locations/${id}`);
};
