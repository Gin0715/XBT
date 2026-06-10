import client from './client';

export interface QuizConfig {
  id: number;
  user_uid: number;
  enabled: boolean;
  auto_answer: boolean;
  monitor_courses: string;
  delay_ms: number;
  course_id: number;
  class_id: number;
  ws_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuizMonitorStatus {
  user_uid: number;
  is_running: boolean;
  connected: boolean;
  last_check: number;
  activity_count: number;
}

export interface QuizRecord {
  id: number;
  user_uid: number;
  activity_id: number;
  user_name: string;
  course_name: string;
  answer_time: number;
  rank: number;
  success: boolean;
  message: string;
  created_at: string;
}

export interface QuizActivity {
  id: number;
  activity_id: number;
  course_id: number;
  class_id: number;
  course_name: string;
  title: string;
  start_time: number;
  end_time: number;
  status: number;
  auto_answer: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuizMetrics {
  total_answers: number;
  success_answers: number;
  failed_answers: number;
  avg_response_ms: number;
  anti_crawl_count: number;
  active_users: number;
  total_goroutines: number;
  last_answer_time: number;
  total_detections: number;
}

// 获取抢答配置
export const getQuizConfig = () => {
  return client.get<QuizConfig>('/quiz/config');
};

// 更新抢答配置
export const updateQuizConfig = (data: Partial<QuizConfig>) => {
  return client.put('/quiz/config', data);
};

// 启动/切换监控（统一一键抢答）
export const toggleQuizMonitor = () => {
  return client.post('/quiz/one-click-answer', {});
};

// 获取监控状态
export const startQuizMonitor = (data?: { course_id?: number; class_id?: number }) => {
  return client.post('/quiz/monitor/start', data || {});
};

// 停止监控
export const stopQuizMonitor = () => {
  return client.post('/quiz/monitor/stop');
};

// 获取统一状态（含预热状态、活动列表、统计）
export const getQuizStatus = () => {
  return client.get('/quiz/status');
};

// 获取抢答记录
export const getQuizRecords = () => {
  return client.get<QuizRecord[]>('/quiz/records');
};

// 获取抢答活动
export const getQuizActivities = () => {
  return client.get<QuizActivity[]>('/quiz/activities');
};

// 获取运行时指标
export const getQuizMetrics = () => {
  return client.get<QuizMetrics>('/quiz/metrics');
};

// 手动抢答（60s 超时，兼容等待学生就位模式的长时间轮询）
export const manualAnswer = (data: { active_id: number; course_id: number; class_id: number }) => {
  return client.post('/quiz/answer', data, { timeout: 60000 });
};

// 一键批量抢答：检测所有进行中活动并全部抢答
export const oneClickAnswer = () => {
  return client.post('/quiz/one-click-answer', {}, { timeout: 120000 });
};

// 清空抢答记录
export const clearQuizRecords = () => {
  return client.delete('/quiz/records');
};
