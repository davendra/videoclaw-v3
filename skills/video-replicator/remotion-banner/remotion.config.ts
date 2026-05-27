import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setCodec("h264");
Config.setPixelFormat("yuva420p"); // Support transparency
