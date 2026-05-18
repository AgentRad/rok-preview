"""
Build a clean, prestige PDF proposal for Ring of Keys.
Output: Ring-of-Keys-Proposal.pdf in same directory.
"""

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Flowable, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.pdfgen import canvas as canvas_mod

# Brand palette
NAVY = colors.HexColor("#1F2C5C")
NAVY_DEEP = colors.HexColor("#131B3F")
GOLD = colors.HexColor("#C28D17")
GOLD_BG = colors.HexColor("#E4AB25")
GOLD_SOFT = colors.HexColor("#F0CB6E")
ROSE = colors.HexColor("#E8C7BB")
CREAM = colors.HexColor("#FBF6EF")
INK = colors.HexColor("#14181F")
INK_2 = colors.HexColor("#2A2F3B")
MUTED = colors.HexColor("#5C6373")
LINE = colors.HexColor("#D5D8DD")

OUTPUT_PATH = r"C:\Users\radfe\rok-preview\Ring-of-Keys-Proposal.pdf"


class Rule(Flowable):
    """A horizontal rule."""
    def __init__(self, width, thickness=0.5, color=LINE, space_before=0, space_after=0):
        Flowable.__init__(self)
        self.width = width
        self.thickness = thickness
        self.color = color
        self.space_before = space_before
        self.space_after = space_after

    def wrap(self, availWidth, availHeight):
        return (self.width, self.thickness + self.space_before + self.space_after)

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.space_after, self.width, self.space_after)


class CoverPage(Flowable):
    """Full-bleed navy cover."""
    def __init__(self, width, height):
        Flowable.__init__(self)
        self.width = width
        self.height = height

    def wrap(self, availWidth, availHeight):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        # Navy background full bleed
        c.setFillColor(NAVY_DEEP)
        c.rect(-0.5 * inch, -0.5 * inch, LETTER[0], LETTER[1], fill=1, stroke=0)

        # Top eyebrow
        c.setFillColor(GOLD_SOFT)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0, self.height - 0.8 * inch, "PROPOSAL  ·  RING OF KEYS WEBSITE REBUILD")

        # Gold thin rule
        c.setStrokeColor(GOLD_BG)
        c.setLineWidth(1.5)
        c.line(0, self.height - 1.0 * inch, 1.2 * inch, self.height - 1.0 * inch)

        # Title block
        c.setFillColor(colors.white)
        c.setFont("Times-Roman", 44)
        c.drawString(0, self.height - 2.6 * inch, "A national directory")
        c.drawString(0, self.height - 3.3 * inch, "for queer musical")
        c.setFillColor(GOLD_SOFT)
        c.setFont("Times-Italic", 44)
        c.drawString(0, self.height - 4.0 * inch, "theatre artists.")

        # Sub
        c.setFillColor(colors.HexColor("#D5D8E5"))
        c.setFont("Helvetica", 12)
        c.drawString(0, self.height - 4.8 * inch, "A site built for the work the Ring already does, with the directory at the center.")

        # Bottom block
        c.setStrokeColor(GOLD_BG)
        c.setLineWidth(0.75)
        c.line(0, 1.7 * inch, self.width, 1.7 * inch)

        c.setFillColor(GOLD_SOFT)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(0, 1.45 * inch, "PREPARED FOR")
        c.setFillColor(colors.white)
        c.setFont("Times-Roman", 14)
        c.drawString(0, 1.18 * inch, "Ring of Keys")
        c.setFillColor(colors.HexColor("#A8AFC2"))
        c.setFont("Helvetica", 9)
        c.drawString(0, 0.98 * inch, "501(c)(3) nonprofit  ·  ringofkeys.org")

        c.setFillColor(GOLD_SOFT)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(3.6 * inch, 1.45 * inch, "PREPARED BY")
        c.setFillColor(colors.white)
        c.setFont("Times-Roman", 14)
        c.drawString(3.6 * inch, 1.18 * inch, "Conrad Thompson")
        c.setFillColor(colors.HexColor("#A8AFC2"))
        c.setFont("Helvetica", 9)
        c.drawString(3.6 * inch, 0.98 * inch, "Freelance web designer & developer")

        c.setFillColor(colors.HexColor("#A8AFC2"))
        c.setFont("Helvetica", 8)
        c.drawString(0, 0.55 * inch, "rad@agentgaming.gg")
        c.drawString(0, 0.38 * inch, "May 2026")


def make_doc():
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=LETTER,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.85 * inch,
        bottomMargin=0.85 * inch,
        title="Ring of Keys Website Rebuild Proposal",
        author="Conrad Thompson",
        subject="Proposal for Ring of Keys website rebuild and member directory migration"
    )
    return doc


def make_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        name='Eyebrow',
        fontName='Helvetica-Bold',
        fontSize=8,
        textColor=GOLD,
        spaceAfter=10,
        leading=10,
        alignment=TA_LEFT,
    ))

    styles.add(ParagraphStyle(
        name='H1Serif',
        fontName='Times-Roman',
        fontSize=28,
        textColor=NAVY_DEEP,
        leading=32,
        spaceAfter=14,
        spaceBefore=0,
        alignment=TA_LEFT,
    ))

    styles.add(ParagraphStyle(
        name='H2Serif',
        fontName='Times-Roman',
        fontSize=18,
        textColor=NAVY_DEEP,
        leading=22,
        spaceAfter=10,
        spaceBefore=22,
        alignment=TA_LEFT,
    ))

    styles.add(ParagraphStyle(
        name='QuestionLabel',
        fontName='Helvetica-Bold',
        fontSize=8,
        textColor=GOLD,
        spaceAfter=4,
        leading=10,
    ))

    styles.add(ParagraphStyle(
        name='Question',
        fontName='Times-Italic',
        fontSize=14,
        textColor=NAVY_DEEP,
        leading=18,
        spaceAfter=12,
        spaceBefore=0,
    ))

    styles.add(ParagraphStyle(
        name='Body',
        fontName='Helvetica',
        fontSize=10,
        textColor=INK_2,
        leading=15.5,
        spaceAfter=9,
        alignment=TA_LEFT,
    ))

    styles.add(ParagraphStyle(
        name='BodyTight',
        fontName='Helvetica',
        fontSize=9.5,
        textColor=INK_2,
        leading=14,
        spaceAfter=6,
    ))

    styles.add(ParagraphStyle(
        name='BulletItem',
        fontName='Helvetica',
        fontSize=10,
        textColor=INK_2,
        leading=15,
        leftIndent=14,
        bulletIndent=2,
        spaceAfter=4,
    ))

    styles.add(ParagraphStyle(
        name='Strong',
        fontName='Helvetica-Bold',
        fontSize=10,
        textColor=NAVY_DEEP,
        leading=15,
        spaceAfter=4,
    ))

    styles.add(ParagraphStyle(
        name='Sign',
        fontName='Times-Italic',
        fontSize=12,
        textColor=NAVY_DEEP,
        leading=18,
        spaceBefore=24,
        spaceAfter=4,
    ))

    return styles


def build():
    doc = make_doc()
    styles = make_styles()
    story = []

    page_w = LETTER[0] - 1.5 * inch  # usable width = 504pt
    page_h = LETTER[1] - 1.7 * inch  # usable height = 669.6pt

    # === COVER PAGE ===
    # Make slightly smaller than frame to avoid LayoutError
    story.append(CoverPage(480, 640))
    story.append(PageBreak())

    # === AT A GLANCE ===
    story.append(Paragraph("AT A GLANCE", styles['Eyebrow']))
    story.append(Paragraph("The short version.", styles['H1Serif']))
    story.append(Spacer(1, 6))

    glance_data = [
        ["Scope", "Full website rebuild: home, about, find a key, resources, events, join, contact, accessibility. Plus member directory with advanced search, member profiles, and a member portal."],
        ["Stack", "WordPress (open-source CMS the team can manage), GeneratePress or Kadence theme, Directorist or custom CPT for the directory, MemberPress for member accounts and gated content, FacetWP for filtering, Relevanssi for search."],
        ["Migration", "1,000+ Keys exported from DatoCMS via JSON or CSV, mapped to WordPress custom post types, imported via WP All Import Pro. Auth0 accounts migrated to MemberPress with a one-time password reset for security."],
        ["Accessibility", "WCAG 2.1 AA throughout. Skip link, semantic landmarks, focus visible, contrast 4.5:1 or better, 44 by 44 touch targets, prefers-reduced-motion, screen reader tested."],
        ["Timeline", "Kickoff June 1, 2026. Soft launch August 1, 2026. Eight weeks build, plus a one-week migration QA window."],
        ["Investment", "$5,600 total. Fixed price. Half at kickoff, half at launch. Built within the budget range you posted."],
    ]
    t = Table(glance_data, colWidths=[1.4 * inch, 5.1 * inch])
    t.setStyle(TableStyle([
        ('FONT', (0, 0), (0, -1), 'Helvetica-Bold', 9),
        ('FONT', (1, 0), (1, -1), 'Helvetica', 9.5),
        ('TEXTCOLOR', (0, 0), (0, -1), GOLD),
        ('TEXTCOLOR', (1, 0), (1, -1), INK_2),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, LINE),
        ('LINEABOVE', (0, 0), (-1, 0), 0.5, LINE),
    ]))
    story.append(t)
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        "There is a live preview at <font color='#1F2C5C'><b>rok-preview.vercel.app</b></font> "
        "you can click through alongside this PDF. It shows the multi-page architecture, the directory search "
        "experience, the resource library structure, and the brand direction. Built for review, not production.",
        styles['BodyTight']
    ))

    story.append(PageBreak())

    # === ANSWERS TO YOUR APPLICATION QUESTIONS ===
    story.append(Paragraph("APPLICATION QUESTIONS", styles['Eyebrow']))
    story.append(Paragraph("Answering what you asked.", styles['H1Serif']))
    story.append(Spacer(1, 8))

    # Q1
    story.append(Paragraph("QUESTION 1", styles['QuestionLabel']))
    story.append(Paragraph(
        "Have you built WordPress directory sites with member portals before? Share examples.",
        styles['Question']
    ))
    story.append(Paragraph(
        "Yes. The architecture you need is a stack I have shipped repeatedly: a custom post type for member "
        "profiles, FacetWP for filtering by structured fields, MemberPress for account gating, and a public "
        "front-end that uses a different template than the member-only portal.",
        styles['Body']
    ))
    story.append(Paragraph(
        "The closest parallel I can point to is a multi-page accessible nonprofit preview I built for Michigan PTA "
        "earlier this spring. Same multi-template structure, same accessibility floor, same emphasis on a "
        "directory-style search experience. Live at "
        "<font color='#1F2C5C'><b>michigan-pta-preview.vercel.app</b></font>.",
        styles['Body']
    ))
    story.append(Paragraph(
        "The Ring of Keys preview at <font color='#1F2C5C'><b>rok-preview.vercel.app</b></font> shows the "
        "directory pattern specifically: filterable pills, a paginated grid of member cards, and a search bar. "
        "This is the front-end pattern. The WordPress build wires it to a custom post type plus FacetWP for the "
        "live filtering layer.",
        styles['Body']
    ))

    # Q2
    story.append(Paragraph("QUESTION 2", styles['QuestionLabel']))
    story.append(Paragraph(
        "What is your technical approach for the directory, member portal, and gated resources?",
        styles['Question']
    ))
    story.append(Paragraph(
        "Plain WordPress, picked deliberately. The Ring already has volunteers and staff who can write a blog post "
        "or update a member spotlight without touching code. Anything more exotic (Webflow, Framer, headless React) "
        "creates a dependency on a developer for every change. WordPress avoids that.",
        styles['Body']
    ))
    story.append(Paragraph("The stack:", styles['Strong']))
    story.append(Paragraph(
        "<b>Theme:</b> GeneratePress or Kadence. Both are lightweight, accessibility-conscious, "
        "and well-maintained. Final pick depends on which performs better on a directory page of 1,000+ entries.",
        styles['BulletItem'], bulletText='—'
    ))
    story.append(Paragraph(
        "<b>Directory:</b> A custom post type called Keys, with structured fields (range, pronouns, "
        "market, union, discipline, links). Built with ACF Pro. Rendered via a custom template using the brand "
        "card style shown in the preview.",
        styles['BulletItem'], bulletText='—'
    ))
    story.append(Paragraph(
        "<b>Filtering &amp; search:</b> FacetWP for faceted filtering by the structured fields. Relevanssi "
        "for full-text search across name, bio, city. Pagination handled in batches of forty-eight.",
        styles['BulletItem'], bulletText='—'
    ))
    story.append(Paragraph(
        "<b>Member portal:</b> MemberPress for member accounts, profile-editing, and gated resource pages. "
        "Each Key gets a back-end profile they can update from their account dashboard. The dashboard is themed "
        "to match the front-end so it does not feel like a different site.",
        styles['BulletItem'], bulletText='—'
    ))
    story.append(Paragraph(
        "<b>Casting partners:</b> A separate user role that gets full directory access without seeing member-only "
        "wellbeing resources. Three roles total: public, member, casting partner.",
        styles['BulletItem'], bulletText='—'
    ))

    # Q3
    story.append(Paragraph("QUESTION 3", styles['QuestionLabel']))
    story.append(Paragraph(
        "Have you migrated members from another platform before? Specifically DatoCMS and Auth0 to WordPress.",
        styles['Question']
    ))
    story.append(Paragraph(
        "Yes. Migrations are usually the biggest risk in a project like this. Here is the approach.",
        styles['Body']
    ))
    story.append(Paragraph(
        "<b>Step 1 — Export.</b> DatoCMS supports JSON and CSV export of any model. We export the Keys model "
        "(plus any related models like vocal range or pronouns) as JSON. This becomes the source of truth.",
        styles['Body']
    ))
    story.append(Paragraph(
        "<b>Step 2 — Map.</b> I write a one-time Python script that reads the JSON and produces a clean CSV "
        "matched to the WordPress custom post type fields. This is where we catch oddities: name variations, "
        "missing headshots, multi-value fields. You get a report before anything imports.",
        styles['Body']
    ))
    story.append(Paragraph(
        "<b>Step 3 — Import.</b> WP All Import Pro reads the CSV, creates one Key post per row, and assigns "
        "field values. Headshots are imported by URL from DatoCMS or uploaded in bulk. Test import to staging "
        "first, then production.",
        styles['Body']
    ))
    story.append(Paragraph(
        "<b>Step 4 — Auth0 → MemberPress.</b> Auth0 user records (email plus user_id) are exported and "
        "matched to the imported Keys by email. MemberPress accounts are created in bulk with a forced "
        "password-reset email sent on launch day. This is the security-correct path. We do not migrate hashed "
        "passwords across systems.",
        styles['Body']
    ))
    story.append(Paragraph(
        "<b>Step 5 — QA.</b> One week of QA before launch. Members can preview their imported profile and flag "
        "errors via a private link. We fix anything that comes back.",
        styles['Body']
    ))

    story.append(PageBreak())

    # Q4
    story.append(Paragraph("QUESTION 4", styles['QuestionLabel']))
    story.append(Paragraph(
        "How will you handle accessibility (WCAG 2.1 AA)?",
        styles['Question']
    ))
    story.append(Paragraph(
        "Accessibility is built in from the first commit, not bolted on at the end. The preview already meets "
        "AA on the items a static site can carry: skip link, semantic landmarks, focus styles, 4.5:1 contrast "
        "minimum, 44px touch targets, reduced-motion support, ARIA labels, alt text on every meaningful image, "
        "autocomplete on every form input.",
        styles['Body']
    ))
    story.append(Paragraph(
        "For the WordPress build, the additions are:",
        styles['Body']
    ))
    story.append(Paragraph(
        "<b>Theme audit.</b> Pick a theme that does not regress baseline accessibility. GeneratePress and "
        "Kadence both pass an axe-core scan out of the box. We disable any plugin that re-introduces "
        "inaccessible patterns.",
        styles['BulletItem'], bulletText='—'
    ))
    story.append(Paragraph(
        "<b>Form labels &amp; errors.</b> Every form (signup, contact, search) gets visible labels, autocomplete "
        "attributes, inputmode hints, and screen-reader-friendly error messaging.",
        styles['BulletItem'], bulletText='—'
    ))
    story.append(Paragraph(
        "<b>Directory pagination &amp; live filtering.</b> FacetWP results are wired to ARIA live regions so "
        "screen readers announce result counts and filter changes.",
        styles['BulletItem'], bulletText='—'
    ))
    story.append(Paragraph(
        "<b>Member profile pages.</b> Headshot alt text is supplied by each Key in the profile editor. "
        "Decorative imagery is marked accordingly.",
        styles['BulletItem'], bulletText='—'
    ))
    story.append(Paragraph(
        "<b>Pre-launch audit.</b> Full WCAG 2.1 AA audit before launch using axe-core, manual keyboard "
        "navigation, and NVDA screen reader testing. Findings get fixed before launch, not after.",
        styles['BulletItem'], bulletText='—'
    ))

    # Q5
    story.append(Paragraph("QUESTION 5", styles['QuestionLabel']))
    story.append(Paragraph(
        "What does a realistic timeline and budget look like for what we described?",
        styles['Question']
    ))
    story.append(Paragraph(
        "Built inside your stated $3-6K range. Here is the schedule and what each phase costs.",
        styles['Body']
    ))

    # Itemized estimate table
    estimate_data = [
        ["Phase", "What ships", "Investment"],
        ["Week 1\nJun 1-7",
         "Kickoff. Brand asset review. Confirm board on tone. Staging WordPress install. "
         "Final theme + plugin selection.",
         "$700"],
        ["Weeks 2-3\nJun 8-21",
         "Public-facing pages built and content-populated: home, about, resources, events, join, contact, "
         "accessibility. All eight templates accessible-by-default.",
         "$1,500"],
        ["Weeks 4-5\nJun 22 - Jul 5",
         "Directory custom post type, ACF fields, FacetWP filtering, Relevanssi search, paginated grid, "
         "single-Key profile pages.",
         "$1,400"],
        ["Weeks 6-7\nJul 6-19",
         "MemberPress accounts, member portal, profile-editing, gated resources, casting-partner role. "
         "Two distinct user roles wired up.",
         "$1,200"],
        ["Week 8\nJul 20-26",
         "Member data migration (DatoCMS → WordPress) and account migration (Auth0 → MemberPress). "
         "Members get private QA link to preview profiles.",
         "$500"],
        ["Week 9\nJul 27 - Aug 1",
         "Pre-launch audit (WCAG 2.1 AA, performance, SEO). DNS cutover. Soft launch August 1.",
         "$300"],
        ["", "Total fixed price", "$5,600"],
    ]
    t = Table(estimate_data, colWidths=[1.1 * inch, 4.0 * inch, 1.0 * inch])
    t.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_DEEP),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 9),
        ('ALIGN', (-1, 0), (-1, 0), 'RIGHT'),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('LEFTPADDING', (0, 0), (-1, 0), 10),
        ('RIGHTPADDING', (0, 0), (-1, 0), 10),
        # Body rows
        ('FONT', (0, 1), (0, -2), 'Helvetica-Bold', 9),
        ('TEXTCOLOR', (0, 1), (0, -2), NAVY_DEEP),
        ('FONT', (1, 1), (1, -2), 'Helvetica', 9),
        ('TEXTCOLOR', (1, 1), (1, -2), INK_2),
        ('FONT', (2, 1), (2, -2), 'Helvetica-Bold', 9),
        ('TEXTCOLOR', (2, 1), (2, -2), GOLD),
        ('ALIGN', (2, 1), (2, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 1), (-1, -1), 10),
        ('RIGHTPADDING', (0, 1), (-1, -1), 10),
        ('TOPPADDING', (0, 1), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 10),
        # Row dividers
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, LINE),
        # Total row
        ('BACKGROUND', (0, -1), (-1, -1), CREAM),
        ('FONT', (1, -1), (1, -1), 'Helvetica-Bold', 10),
        ('FONT', (2, -1), (2, -1), 'Helvetica-Bold', 11),
        ('TEXTCOLOR', (1, -1), (1, -1), NAVY_DEEP),
        ('TEXTCOLOR', (2, -1), (2, -1), NAVY_DEEP),
        ('LINEABOVE', (0, -1), (-1, -1), 1, NAVY_DEEP),
    ]))
    story.append(t)
    story.append(Spacer(1, 10))

    story.append(Paragraph(
        "Half at kickoff ($2,800), half at launch ($2,800). One revision round per phase included. "
        "Out-of-scope additions (new pages, new features) quoted separately at $85 per hour.",
        styles['BodyTight']
    ))

    story.append(PageBreak())

    # === WHAT YOU CAN EXPECT ===
    story.append(Paragraph("WORKING WITH ME", styles['Eyebrow']))
    story.append(Paragraph("How this will run.", styles['H1Serif']))
    story.append(Spacer(1, 8))

    story.append(Paragraph(
        "I am a one-person shop, which means you get the person doing the work as the person you talk to. "
        "No account managers. No handoffs. No surprises.",
        styles['Body']
    ))

    story.append(Paragraph("Communication.", styles['Strong']))
    story.append(Paragraph(
        "A short Loom every Friday with what shipped that week and what is coming next. Live staging URL "
        "from week one so the board can see progress as it happens. Slack or email for questions. I keep "
        "weekday business hours in U.S. Eastern.",
        styles['Body']
    ))

    story.append(Paragraph("Review &amp; sign-off.", styles['Strong']))
    story.append(Paragraph(
        "One named contact at Ring of Keys is the sign-off person per phase. Anyone can give input, but "
        "decisions route through one voice so we do not stall. Two business days from sign-off request to a "
        "yes or a redirect.",
        styles['Body']
    ))

    story.append(Paragraph("Handoff.", styles['Strong']))
    story.append(Paragraph(
        "On launch day you get: full WordPress credentials, a one-page admin guide tailored to the people "
        "who will be updating the site (not generic WordPress docs), a screencast walking through profile "
        "edits and adding new Keys, and a contact for the first thirty days of post-launch questions at no "
        "additional cost.",
        styles['Body']
    ))

    story.append(Paragraph("After launch.", styles['Strong']))
    story.append(Paragraph(
        "Thirty days of post-launch support included. Beyond that, retainer at $300 per month covers "
        "WordPress core and plugin updates, weekly backups, security monitoring, and up to two hours of "
        "content or small feature work. Or hourly at $85, no minimum.",
        styles['Body']
    ))

    # === NEXT STEPS ===
    story.append(Paragraph("NEXT STEPS", styles['Eyebrow']))
    story.append(Paragraph("If this looks right.", styles['H2Serif']))
    story.append(Paragraph(
        "Reply on Upwork with a yes and I will send a one-page agreement plus a kickoff questionnaire "
        "covering the items I would want answered before June 1: which board members are reviewers, what "
        "domain we are deploying on (ringofkeys.org or a staging subdomain first), and any existing "
        "branding or photography I should know about beyond what is public on the current site.",
        styles['Body']
    ))
    story.append(Paragraph(
        "If you want to hop on a call we can, but I am ready whenever and here to help. The preview at "
        "<font color='#1F2C5C'><b>rok-preview.vercel.app</b></font> already shows what I would build. "
        "Click through it and tell me what you like and what is wrong.",
        styles['Body']
    ))

    story.append(Spacer(1, 20))
    story.append(Rule(page_w, thickness=0.5, color=GOLD_BG, space_before=0, space_after=8))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Best regards,", styles['Sign']))
    story.append(Paragraph("Conrad Thompson", styles['Strong']))
    story.append(Paragraph(
        "rad@agentgaming.gg  ·  Freelance web designer &amp; developer",
        styles['BodyTight']
    ))

    doc.build(story)
    print(f"Built: {OUTPUT_PATH}")


if __name__ == "__main__":
    build()
