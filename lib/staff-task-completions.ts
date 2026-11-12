import type { SupabaseClient } from "@supabase/supabase-js";

import type { StaffTaskType } from "@/lib/staff-task-claims";

type StaffCompletionActor = {
  staffId: number;
  fullName: string;
  employeeCode: string;
};

export async function recordStaffTaskCompletion(
  admin: SupabaseClient,
  staff: StaffCompletionActor | null,
  taskType: StaffTaskType,
  taskId: string,
  action: string,
) {
  if (!staff) return;
  const { error } = await admin.from("staff_task_completions").insert({
    staff_member_id: staff.staffId,
    staff_name: staff.fullName,
    employee_code: staff.employeeCode,
    task_type: taskType,
    task_id: taskId,
    action,
  });
  if (error) {
    console.error("Task was completed, but its staff completion record could not be saved.", error);
    throw new Error("The task was completed, but its completion count could not be recorded. Contact the owner administrator.");
  }
}
