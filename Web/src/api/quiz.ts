import client from './client';

export interface QuizConfig {
  id: number;
  user_uid: number;
  enabled: boolean;
  auto_answer: boolean;
  monitor_courses: string;
  delay_ms: number;
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

// 获取抢答配置
export const getQuizConfig = () => {
  return client.get<QuizConfig>('/quiz/config');
};

// 更新抢答配置
export const updateQuizConfig = (data: Partial<QuizConfig>) => {
  return client.put('/quiz/config', data);
};

// 启动监控
export const startQuizMonitor = () => {
  return client.post('/quiz/monitor/start');
};

// 停止监控
export const stopQuizMonitor = () => {
  return client.post('/quiz/monitor/stop');
};

// 获取监控状态
export const getQuizStatus = () => {
  return client.get<QuizMonitorStatus>('/quiz/status');
};

// 获取抢答记录
export const getQuizRecords = () => {
  return client.get<QuizRecord[]>('/quiz/records');
};

// 获取抢答活动
export const getQuizActivities = () => {
  return client.get<QuizActivity[]>('/quiz/activities');
};

// 手动抢答
export const manualAnswer = (activityId: number) => {
  return client.post('/quiz/answer', { activity_id: activityId });
};
