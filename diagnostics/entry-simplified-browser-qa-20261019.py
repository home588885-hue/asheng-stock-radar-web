"""Read-only, locally rendered V2 ENTRY mobile/desktop smoke test.
No login, S/C calls, portfolio writes, trading requests or live source manipulation.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

fixture=Path(__file__).with_name('entry-preview-20261019.html').resolve()
assert fixture.is_file(), 'Synthetic UI fixture not generated'
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    for name,width,height,mobile in [('desktop',1440,900,False),('mobile',390,844,True)]:
        context=browser.new_context(viewport={'width':width,'height':height},
                                    is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
        page=context.new_page()
        page.goto(fixture.as_uri(), wait_until='domcontentloaded',timeout=15000)
        sections=page.locator('section[data-stable-key^="entry-simple-"]')
        assert sections.count()==4,(name,'expected three main sections plus collapsed history',sections.count())
        # Current production UI keeps the two actionable/watch shelves flat,
        # while risk and history remain collapsed. Do not require retired folds.
        assert page.locator('[data-stable-key="entry-simple-today"] .entry-bucket-flat').count()==1
        assert page.locator('[data-stable-key="entry-simple-tracking"] .entry-bucket-flat').count()==1
        assert page.locator('[data-entry-fold="simple-risk"]').evaluate('(e)=>e.open') is False
        assert page.locator('[data-entry-fold="simple-history"]').evaluate('(e)=>e.open') is False
        widthinfo=page.evaluate("""() => ({
          viewport:window.innerWidth,
          html:document.documentElement.scrollWidth,
          body:document.body.scrollWidth
        })""")
        assert widthinfo['html']<=widthinfo['viewport']+2,(name,'horizontal overflow',widthinfo)
        page.locator('summary',has_text='最近失效追蹤').first.click()
        assert page.locator('[data-entry-fold="simple-history"]').evaluate('(e)=>e.open') is True
        assert page.locator('[data-entry-fold="simple-history"] [data-tracking-symbol]').count()==40
        page.locator('summary',has_text='暫不適合進場').first.click()
        assert page.locator('[data-entry-fold="simple-risk"]').evaluate('(e)=>e.open') is True
        page.locator('[data-stock-key="1006"] summary').click()
        assert page.locator('[data-stock-key="1006"]').evaluate('(e)=>e.open') is True
        assert page.locator('[data-tracking-symbol="2001"]').count()==1
        assert page.locator('[data-tracking-symbol="1003"]').count()==0
        print(f'PASS {name} {width}x{height}: groups, details, dedup, archive, no horizontal overflow')
        context.close()
    browser.close()
