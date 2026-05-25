# Homebrew formula for vclaw-video-core.
#
# This file is the source of truth. Copy it into your tap repository
# (typically davendra/homebrew-vclaw) as Formula/vclaw.rb and update
# `url` + `sha256` each release. See docs/PUBLISHING.md for the full
# publish-and-tap workflow.

class Vclaw < Formula
  desc "Clean-room CLI for multi-provider AI video orchestration with on-disk artifacts"
  homepage "https://github.com/davendra/vclaw-video-core"

  # After `npm publish`, point `url` at the published tarball and replace
  # `sha256` with the checksum printed by `shasum -a 256 vclaw-video-core-<ver>.tgz`.
  url "https://registry.npmjs.org/vclaw-video-core/-/vclaw-video-core-0.1.0.tgz"
  sha256 "REPLACE_WITH_TARBALL_SHA256"
  license :cannot_represent # source-available, commercial use requires paid license

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match(/vclaw video/, shell_output("#{bin}/vclaw --help 2>&1", 0))
    assert_match(/vclaw video providers/, shell_output("#{bin}/vclaw video providers 2>&1"))
  end
end
