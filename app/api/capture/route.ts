import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const ALLOWED_LABELS = new Set(["shadow_clone", "none"]);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const label = formData.get("label");
    const image = formData.get("image");

    if (
      typeof label !== "string" ||
      !ALLOWED_LABELS.has(label)
    ) {
      return Response.json(
        { error: "Invalid label" },
        { status: 400 }
      );
    }

    if (!(image instanceof File)) {
      return Response.json(
        { error: "Image file is required" },
        { status: 400 }
      );
    }

    const directory = path.join(
      process.cwd(),
      "dataset",
      label
    );

    await mkdir(directory, { recursive: true });

    const extension =
      image.type === "image/png" ? "png" : "jpg";

    const filename = `${Date.now()}-${randomUUID()}.${extension}`;

    const buffer = Buffer.from(
      await image.arrayBuffer()
    );

    await writeFile(
      path.join(directory, filename),
      buffer
    );

    const files = await readdir(directory);

    const count = files.filter(
      (file) =>
        file.endsWith(".jpg") ||
        file.endsWith(".png")
    ).length;

    return Response.json({
      ok: true,
      filename,
      count,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Failed to save image" },
      { status: 500 }
    );
  }
}