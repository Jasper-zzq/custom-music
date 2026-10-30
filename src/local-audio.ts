function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("music-web-audio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开本地音频存储"));
  });
}
export async function storeAudio(id: string, file: File) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(file, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error("本地音频保存失败，可能空间不足"));
      tx.onabort = () => reject(new Error("本地音频保存被中止"));
    });
  } finally {
    db.close();
  }
}
export async function readAudio(id: string): Promise<Blob> {
  const db = await database();
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const request = db.transaction("files").objectStore("files").get(id);
      request.onsuccess = () =>
        request.result
          ? resolve(request.result)
          : reject(new Error("找不到本地音频，请重新导入文件"));
      request.onerror = () => reject(new Error("本地音频读取失败"));
    });
  } finally {
    db.close();
  }
}
