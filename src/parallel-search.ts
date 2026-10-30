export interface SearchTask {
  source: string;
  page: number;
}
export interface SearchOutcome extends SearchTask {
  items: any[];
  isEnd: boolean;
  error: string;
}
type SearchCall = (source: string, method: string, args: any[]) => Promise<any>;
// Dispatch every source before awaiting completion; report partial successes immediately.
export async function searchBatch(
  tasks: SearchTask[],
  query: string,
  type: string,
  searchCall: SearchCall,
  settled: (result: SearchOutcome) => void,
) {
  await Promise.all(
    tasks.map(async (task) => {
      try {
        const data = await searchCall(task.source, "search", [
          query,
          task.page,
          type,
        ]);
        if (!Array.isArray(data?.data)) throw new Error("音源返回的数据不兼容");
        settled({
          ...task,
          items: data.data,
          isEnd:
            typeof data.isEnd === "boolean"
              ? data.isEnd
              : data.data.length < 20,
          error: "",
        });
      } catch (error) {
        settled({
          ...task,
          items: [],
          isEnd: false,
          error: error instanceof Error ? error.message : "搜索失败",
        });
      }
    }),
  );
}
