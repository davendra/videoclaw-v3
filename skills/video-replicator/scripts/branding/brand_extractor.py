#!/usr/bin/env python3
"""
Brand Extraction from Websites.

Extracts brand information (logo, colors, fonts, contact) from a website URL.
Uses web fetching and CSS/HTML parsing to auto-populate brand configuration.
"""

import re
import ssl
import urllib.request
from urllib.parse import urljoin, urlparse

from .brand_config import BrandConfig, SocialConfig, TypographyConfig

# User-Agent to avoid bot detection
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def fetch_url(url: str, timeout: int = 10) -> str | None:
    """
    Fetch content from URL with proper headers.

    Args:
        url: URL to fetch
        timeout: Request timeout in seconds

    Returns:
        Response content as string, or None if fetch fails
    """
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        # Create SSL context that doesn't verify certificates (for self-signed certs)
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
            # Try to decode as UTF-8, fall back to latin-1
            content = response.read()
            try:
                return content.decode("utf-8")
            except UnicodeDecodeError:
                return content.decode("latin-1")
    except Exception as e:
        print(f"  Warning: Failed to fetch {url}: {e}")
        return None


def extract_css_urls(html_content: str, base_url: str) -> list[str]:
    """
    Extract CSS stylesheet URLs from HTML.

    Args:
        html_content: HTML text to parse
        base_url: Base URL for resolving relative paths

    Returns:
        List of absolute CSS URLs
    """
    # Match <link rel="stylesheet" href="...">
    pattern = r'<link[^>]+rel=["\']stylesheet["\'][^>]+href=["\']([^"\']+)["\']'
    pattern2 = r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']stylesheet["\']'

    urls = []
    for p in [pattern, pattern2]:
        for match in re.finditer(p, html_content, re.IGNORECASE):
            href = match.group(1)
            if not href.startswith("data:"):
                urls.append(urljoin(base_url, href))

    # Also look for @import in inline styles
    import_pattern = r'@import\s+["\']([^"\']+)["\']'
    for match in re.finditer(import_pattern, html_content):
        urls.append(urljoin(base_url, match.group(1)))

    return list(set(urls))  # Dedupe


def extract_inline_css(html_content: str) -> str:
    """
    Extract inline CSS from <style> tags.

    Args:
        html_content: HTML text to parse

    Returns:
        Combined CSS content from all style tags
    """
    pattern = r'<style[^>]*>(.*?)</style>'
    matches = re.findall(pattern, html_content, re.IGNORECASE | re.DOTALL)
    return "\n".join(matches)


def extract_brand_from_url(url: str) -> BrandConfig | None:
    """
    Extract brand information from a website URL.

    Args:
        url: Website URL to analyze

    Returns:
        BrandConfig with extracted information, or None if extraction fails
    """
    # Normalize URL
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"

    parsed = urlparse(url)
    domain = parsed.netloc.replace("www.", "")

    print(f"  Fetching {url}...")
    html_content = fetch_url(url)
    if not html_content:
        print("  Error: Could not fetch website")
        return None

    # Extract CSS (inline + external stylesheets)
    css_content = extract_inline_css(html_content)
    css_urls = extract_css_urls(html_content, url)

    print(f"  Found {len(css_urls)} stylesheet(s)")
    for css_url in css_urls[:5]:  # Limit to first 5 stylesheets
        css = fetch_url(css_url)
        if css:
            css_content += "\n" + css

    # Create brand config
    brand_name = domain.split(".")[0].title()  # e.g., "handyside" -> "Handyside"
    config = BrandConfig(brand_name=brand_name, source_url=url)

    # Extract logo
    print("  Looking for logo...")
    logo_url = find_logo_from_html(html_content, url)
    if logo_url:
        config.logos.full = logo_url
        print(f"    Found: {logo_url[:50]}...")

    # Extract contact info
    print("  Looking for phone number...")
    phone = find_phone_from_html(html_content)
    if phone:
        config.contact.phone = phone
        print(f"    Found: {phone}")

    config.contact.website = url

    # Extract email
    print("  Looking for email...")
    email = find_email_from_html(html_content)
    if email:
        config.contact.email = email
        print(f"    Found: {email}")

    # Extract colors
    print("  Analyzing colors...")
    colors = extract_colors_from_css(css_content)
    if colors:
        # Filter out common neutral colors
        non_neutral = [
            (c, n)
            for c, n in colors
            if c not in ("#FFFFFF", "#000000", "#FFFFFE", "#F5F5F5", "#FAFAFA")
        ]
        if non_neutral:
            config.colors.primary = non_neutral[0][0]
            print(f"    Primary: {config.colors.primary}")
            if len(non_neutral) > 1:
                config.colors.secondary = non_neutral[1][0]
                print(f"    Secondary: {config.colors.secondary}")
            if len(non_neutral) > 2:
                config.colors.accent = non_neutral[2][0]

        # Try to detect background color
        bg_colors = [c for c, n in colors if c in ("#FFFFFF", "#FAFAFA", "#F5F5F5")]
        if bg_colors:
            config.colors.background = bg_colors[0]
        else:
            config.colors.background = "#FFFFFF"

        # Try to detect text color
        text_colors = [c for c, n in colors if c in ("#000000", "#333333", "#1A1A1A", "#212121")]
        if text_colors:
            config.colors.text = text_colors[0]

    # Extract fonts
    print("  Analyzing fonts...")
    typography = detect_fonts_from_css(css_content)
    if typography.heading:
        config.typography = typography
        print(f"    Heading: {typography.heading}")
        if typography.body:
            print(f"    Body: {typography.body}")

    # Extract social links
    print("  Looking for social links...")
    social = find_social_links(html_content)
    config.social = social
    social_count = sum(1 for attr in ["instagram", "facebook", "youtube", "tiktok", "twitter"] if getattr(social, attr))
    if social_count:
        print(f"    Found {social_count} social link(s)")

    return config


def find_email_from_html(html_content: str) -> str | None:
    """
    Find email address from HTML content.

    Args:
        html_content: HTML text to parse

    Returns:
        Email address string, or None if not found
    """
    # Check for mailto: links first
    mailto_pattern = r'href="mailto:([^"?]+)'
    mailto_match = re.search(mailto_pattern, html_content)
    if mailto_match:
        return mailto_match.group(1)

    # Look for email patterns
    email_pattern = r'\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b'
    match = re.search(email_pattern, html_content)
    if match:
        email = match.group(1)
        # Filter out common non-contact emails
        if not any(skip in email.lower() for skip in ["noreply", "no-reply", "privacy", "example"]):
            return email

    return None


def extract_colors_from_css(css_content: str) -> list[tuple[str, int]]:
    """
    Extract hex colors from CSS content, ranked by frequency.

    Args:
        css_content: CSS text to parse

    Returns:
        List of (hex_color, count) tuples, sorted by frequency
    """
    # Find all hex colors
    hex_pattern = r'#([0-9a-fA-F]{3,6})\b'
    matches = re.findall(hex_pattern, css_content)

    # Normalize to 6-digit hex
    normalized = []
    for match in matches:
        if len(match) == 3:
            # Expand 3-digit to 6-digit
            match = "".join(c * 2 for c in match)
        normalized.append(f"#{match.upper()}")

    # Count frequencies
    color_counts: dict[str, int] = {}
    for color in normalized:
        color_counts[color] = color_counts.get(color, 0) + 1

    # Sort by frequency
    return sorted(color_counts.items(), key=lambda x: x[1], reverse=True)


def find_logo_from_html(html_content: str, base_url: str) -> str | None:
    """
    Find logo URL from HTML content.

    Checks in order:
    1. og:image meta tag
    2. <img> with "logo" in class, id, or alt
    3. <a> with "logo" class containing <img>
    4. Site icon / apple-touch-icon
    5. favicon

    Args:
        html_content: HTML text to parse
        base_url: Base URL for resolving relative paths

    Returns:
        Absolute URL to logo, or None if not found
    """
    # 1. Check og:image meta tag (often the logo or brand image)
    og_pattern = r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']'
    og_pattern2 = r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']'

    for pattern in [og_pattern, og_pattern2]:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            img_url = match.group(1)
            # Skip generic/placeholder og:images
            if not any(skip in img_url.lower() for skip in ["placeholder", "default", "share"]):
                return urljoin(base_url, img_url)

    # 2. Look for <img> with "logo" in class, id, alt, or src
    img_patterns = [
        r'<img[^>]+class=["\'][^"\']*logo[^"\']*["\'][^>]+src=["\']([^"\']+)["\']',
        r'<img[^>]+src=["\']([^"\']+)["\'][^>]+class=["\'][^"\']*logo[^"\']*["\']',
        r'<img[^>]+id=["\'][^"\']*logo[^"\']*["\'][^>]+src=["\']([^"\']+)["\']',
        r'<img[^>]+src=["\']([^"\']+)["\'][^>]+id=["\'][^"\']*logo[^"\']*["\']',
        r'<img[^>]+alt=["\'][^"\']*logo[^"\']*["\'][^>]+src=["\']([^"\']+)["\']',
        r'<img[^>]+src=["\']([^"\']+)["\'][^>]+alt=["\'][^"\']*logo[^"\']*["\']',
        r'<img[^>]+src=["\']([^"\']*logo[^"\']*)["\']',  # src contains "logo"
    ]

    for pattern in img_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            img_url = match.group(1)
            if not img_url.startswith("data:"):  # Skip data URIs
                return urljoin(base_url, img_url)

    # 3. Look for <a> with "logo" class containing an <img>
    link_logo_pattern = r'<a[^>]+class=["\'][^"\']*logo[^"\']*["\'][^>]*>.*?<img[^>]+src=["\']([^"\']+)["\']'
    match = re.search(link_logo_pattern, html_content, re.IGNORECASE | re.DOTALL)
    if match:
        img_url = match.group(1)
        if not img_url.startswith("data:"):
            return urljoin(base_url, img_url)

    # 4. Look for SVG logo in inline style or element
    svg_patterns = [
        r'<[^>]+class=["\'][^"\']*logo[^"\']*["\'][^>]*>.*?<svg',  # Element with logo class containing SVG
    ]
    for pattern in svg_patterns:
        if re.search(pattern, html_content, re.IGNORECASE | re.DOTALL):
            # SVG found but can't extract URL - try favicon instead
            break

    # 5. Look for apple-touch-icon (high-res icon)
    apple_pattern = r'<link[^>]+rel=["\']apple-touch-icon["\'][^>]+href=["\']([^"\']+)["\']'
    apple_pattern2 = r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']apple-touch-icon["\']'

    for pattern in [apple_pattern, apple_pattern2]:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            return urljoin(base_url, match.group(1))

    # 6. Look for site icon
    icon_pattern = r'<link[^>]+rel=["\'](?:shortcut )?icon["\'][^>]+href=["\']([^"\']+)["\']'
    icon_pattern2 = r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\'](?:shortcut )?icon["\']'

    for pattern in [icon_pattern, icon_pattern2]:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            return urljoin(base_url, match.group(1))

    # 7. Default favicon path
    parsed = urlparse(base_url)
    favicon_url = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    return favicon_url  # Return default favicon as last resort


def find_phone_from_html(html_content: str) -> str | None:
    """
    Find phone number from HTML content.

    Looks for:
    1. tel: links
    2. Common phone number patterns

    Args:
        html_content: HTML text to parse

    Returns:
        Phone number string, or None if not found
    """
    # Check for tel: links first
    tel_pattern = r'href="tel:([^"]+)"'
    tel_match = re.search(tel_pattern, html_content)
    if tel_match:
        return tel_match.group(1)

    # Look for phone number patterns
    phone_patterns = [
        r'\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b',  # US format
        r'\b(\+44\s?\d{2,4}\s?\d{3,4}\s?\d{3,4})\b',  # UK format
    ]

    for pattern in phone_patterns:
        match = re.search(pattern, html_content)
        if match:
            return match.group(1)

    return None


def find_social_links(html_content: str) -> SocialConfig:
    """
    Find social media links from HTML content.

    Args:
        html_content: HTML text to parse

    Returns:
        SocialConfig with found social handles
    """
    social = SocialConfig()

    # Social media URL patterns
    patterns = {
        "instagram": r'instagram\.com/([^/"\s?]+)',
        "facebook": r'facebook\.com/([^/"\s?]+)',
        "youtube": r'youtube\.com/(?:@|c/|channel/|user/)?([^/"\s?]+)',
        "tiktok": r'tiktok\.com/@?([^/"\s?]+)',
        "twitter": r'(?:twitter|x)\.com/([^/"\s?]+)',
    }

    for platform, pattern in patterns.items():
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            handle = match.group(1)
            if handle not in ("share", "sharer", "intent"):  # Filter out share URLs
                setattr(social, platform, f"@{handle}" if not handle.startswith("@") else handle)

    return social


def detect_fonts_from_css(css_content: str) -> TypographyConfig:
    """
    Detect font families from CSS content.

    Args:
        css_content: CSS text to parse

    Returns:
        TypographyConfig with detected fonts
    """
    typography = TypographyConfig()

    # Look for Google Fonts imports
    google_fonts_pattern = r'fonts\.googleapis\.com/css[^"\']*family=([^&"\'\s]+)'
    google_match = re.search(google_fonts_pattern, css_content)
    if google_match:
        font_str = google_match.group(1).replace("+", " ")
        fonts = [f.split(":")[0] for f in font_str.split("|")]
        if fonts:
            typography.heading = fonts[0]
            if len(fonts) > 1:
                typography.body = fonts[1]

    # Look for font-family declarations
    font_family_pattern = r'font-family:\s*["\']?([^;"\'\n]+)["\']?'
    font_matches = re.findall(font_family_pattern, css_content)

    if font_matches and not typography.heading:
        # Use most common font
        font_counts: dict[str, int] = {}
        for font in font_matches:
            primary_font = font.split(",")[0].strip().strip("'\"")
            if primary_font not in ("inherit", "sans-serif", "serif", "monospace"):
                font_counts[primary_font] = font_counts.get(primary_font, 0) + 1

        if font_counts:
            sorted_fonts = sorted(font_counts.items(), key=lambda x: x[1], reverse=True)
            typography.heading = sorted_fonts[0][0]
            if len(sorted_fonts) > 1:
                typography.body = sorted_fonts[1][0]

    return typography


def display_extraction_confirmation(config: BrandConfig) -> None:
    """
    Display extracted brand information for user confirmation.

    Args:
        config: BrandConfig with extracted data
    """
    print(f"┌{'─' * 53}┐")
    print(f"│  BRAND EXTRACTION: {config.source_url or 'unknown':<32}│")
    print(f"├{'─' * 53}┤")

    # Logo
    if config.logos.full:
        print("│  Logo:    ✓ Found                                   │")
    else:
        print("│  Logo:    ✗ Not found                               │")

    # Phone
    if config.contact.phone:
        print(f"│  Phone:   ✓ {config.contact.phone:<40}│")
    else:
        print("│  Phone:   ✗ Not found                               │")

    # Website
    if config.contact.website:
        print(f"│  Website: ✓ {config.contact.website:<40}│")
    else:
        print("│  Website: ✗ Not found                               │")

    # Colors
    if config.colors.primary:
        print(f"│  Colors:  ✓ {config.colors.primary} (primary)                       │")
    else:
        print("│  Colors:  ✗ Not found                               │")

    # Fonts
    if config.typography.heading:
        print(f"│  Fonts:   ✓ {config.typography.heading:<40}│")
    else:
        print("│  Fonts:   ✗ Not found                               │")

    # Social
    social_found = []
    if config.social.instagram:
        social_found.append("Instagram")
    if config.social.facebook:
        social_found.append("Facebook")
    if config.social.youtube:
        social_found.append("YouTube")
    if social_found:
        print(f"│  Social:  ✓ {', '.join(social_found):<40}│")
    else:
        print("│  Social:  ✗ Not found                               │")

    print("│                                                     │")
    print("│  [Confirm] [Edit] [Cancel]                          │")
    print(f"└{'─' * 53}┘")
