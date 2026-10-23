import { v2 as cloudinary } from "cloudinary";
import { env, assertCloudinary } from "../env";

let configured = false;
function ensure() {
  assertCloudinary();
  if (!configured) {
    cloudinary.config({
      cloud_name: env.cloudinaryCloud,
      api_key: env.cloudinaryKey,
      api_secret: env.cloudinarySecret,
    });
    configured = true;
  }
}

/** Sign params for a direct browser upload to Cloudinary (unsigned preset not needed). */
export function signUpload(folder: string) {
  ensure();
  const timestamp = Math.round(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, env.cloudinarySecret);
  return {
    cloudName: env.cloudinaryCloud,
    apiKey: env.cloudinaryKey,
    timestamp,
    signature,
    folder,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinaryCloud}/image/auto/upload`,
  };
}
