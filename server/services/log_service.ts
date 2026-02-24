import Logs from '../dao/logs';

interface LogData {
  userId: string;
  contractNo?: string;
  action: string;
  track: any;
}

export const logAction = async (data: any) => {
  try {
    const { userId, contractNo, action, track, status } = data;
    await Logs.create({
      userId: userId,
      contractNo: contractNo || null,
      action: action,
      track: typeof track === 'string' ? track : JSON.stringify(track),
      status: status
    });
  } catch (error) {
    console.error('Failed to log action:', error);
  }
};

export const logUserAction = (userId: string, action: string, details: any, contractNo?: string) => {
  return logAction({
    userId,
    contractNo,
    action,
    track: {
      timestamp: new Date().toISOString(),
      details,
      ip: details.ip || 'unknown',
      userAgent: details.userAgent || 'unknown'
    },
    status: 'success'
  });
};
