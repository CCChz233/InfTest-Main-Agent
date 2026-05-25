import type { TaskOperation, TaskStatus } from '../schemas/task.js'

export type TaskControlState = {
  task_id: string
  status: TaskStatus
  updated_at: string
}

const store = new Map<string, TaskControlState>()

function statusForOperation(operation: TaskOperation): TaskStatus {
  switch (operation) {
    case 'START':
      return 'RUNNING'
    case 'PAUSE':
      return 'PAUSED'
    case 'CONTINUE':
      return 'RUNNING'
    case 'TERMINATE':
      return 'TERMINATED'
  }
}

export class TaskControlStore {
  apply(taskId: string, operation: TaskOperation): TaskControlState {
    const state = {
      task_id: taskId,
      status: statusForOperation(operation),
      updated_at: new Date().toISOString(),
    }
    store.set(taskId, state)
    return state
  }

  get(taskId: string): TaskControlState | undefined {
    return store.get(taskId)
  }
}
