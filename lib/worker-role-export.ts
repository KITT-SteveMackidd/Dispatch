import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx/xlsx.mjs';
import { toLocalDateKey, type WorkerRoleExport } from '@/lib/worker-role-export-data';

export { buildWorkerRoleExport } from '@/lib/worker-role-export-data';

export async function shareWorkerRoleSpreadsheet(params: {
  report: WorkerRoleExport;
  startDate: Date;
  endDate: Date;
}) {
  if (!params.report.rows.length) {
    throw new Error('No filled roles were found in the selected date range.');
  }

  const workbook = XLSX.utils.book_new();
  const values = [
    ['Role', ...params.report.dates.map(formatSpreadsheetDate)],
    ...params.report.rows.map((row) => [
      row.roleTitle,
      ...params.report.dates.map((date) => row.workersByDate[date].join('\n')),
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(values);
  worksheet['!cols'] = [
    { wch: Math.max(18, ...params.report.rows.map((row) => row.roleTitle.length + 2)) },
    ...params.report.dates.map(() => ({ wch: 24 })),
  ];
  worksheet['!rows'] = values.map((_, index) => ({ hpt: index === 0 ? 22 : 34 }));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Worker Roles');

  const fileName = `dispatch-worker-roles-${toLocalDateKey(params.startDate)}-to-${toLocalDateKey(params.endDate)}.xlsx`;
  if (Platform.OS === 'web') {
    XLSX.writeFile(workbook, fileName);
    return;
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('File sharing is not available on this device.');
  }

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(new Uint8Array(bytes));
  await Sharing.shareAsync(file.uri, {
    dialogTitle: 'Export worker roles',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
  });
}

function formatSpreadsheetDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${month}/${day}/${year}`;
}
