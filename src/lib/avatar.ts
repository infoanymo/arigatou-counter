export const maxAvatarBytes = 400_000;

export function readAvatarFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

export function isValidAvatarFile(file: File) {
  return file.type.startsWith("image/") && file.size <= maxAvatarBytes;
}
