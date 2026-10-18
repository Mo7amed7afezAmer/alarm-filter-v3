// P7-T06: `TempFiles` and `Share` on the device (expo-file-system cache directory, expo-sharing).
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { Share, TempFiles } from "./files";

export const nativeFiles: TempFiles = {
  async write(name, bytes) {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return file.uri;
  },
  async remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  async list() {
    return Paths.cache
      .list()
      .filter((e): e is File => e instanceof File)
      .map((f) => ({ name: f.name, uri: f.uri }));
  },
};

export const nativeShare: Share = (uri, options) => Sharing.shareAsync(uri, options);
