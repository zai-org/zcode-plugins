import { shallowRef } from "vue";

export const dialog = shallowRef<{
  title: string;
  value: string;
  paths?: string[];
  resolve: (value: string | null) => void;
} | null>(null);
export function askPath(title: string, value: string, paths?: string[]): Promise<string | null> {
  dialog.value?.resolve(null);
  return new Promise((resolve) => {
    dialog.value = {
      title,
      value,
      paths,
      resolve: (result) => {
        dialog.value = null;
        resolve(result);
      },
    };
  });
}
