"""Smoke-test the *same* expandable V2 card element on desktop and mobile.
Fixture is generated directly from the production admin.html research renderer,
with a stubbed complete-stock component. No real account, quotes, or scans.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
path=Path(__file__).with_name('night-research-fixture-20261019.html').resolve()
assert path.is_file(), 'missing local night-research fixture'
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    for kind,width,height,mobile in [('desktop',1440,900,False),('mobile',390,844,True)]:
        ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=mobile,has_touch=mobile)
        page=ctx.new_page()
        page.goto(path.as_uri(),wait_until='domcontentloaded',timeout=20000)
        study=page.locator('.entry-research-details[data-stock-key="1111"]')
        blocked=page.locator('.entry-research-details[data-stock-key="4444"]')
        assert study.count()==1,(kind,'missing normal candidate details')
        assert blocked.count()==1,(kind,'missing blocked details')
        assert not study.evaluate('(d)=>d.open')
        assert not page.locator('[data-complete-stock="1111"]').is_visible()
        study.locator('summary').click()
        assert study.evaluate('(d)=>d.open')
        assert page.locator('[data-complete-stock="1111"]').is_visible()
        assert page.locator('[data-complete-stock="1111"]').get_attribute('data-trialable')=='false'
        assert page.locator('[data-complete-stock="1111"]').get_attribute('data-buyable')=='false'
        study.locator('summary').click()
        assert not study.evaluate('(d)=>d.open')
        blocked.locator('summary').click()
        assert blocked.evaluate('(d)=>d.open')
        assert page.locator('[data-complete-stock="4444"]').is_visible()
        assert page.locator('[data-complete-stock="4444"]').get_attribute('data-buyable')=='false'
        dimensions=page.evaluate("""() => ({screen:window.innerWidth,doc:document.documentElement.scrollWidth})""")
        assert dimensions['doc']<=dimensions['screen']+2,(kind,'horizontal overflow',dimensions)
        print('PASS',kind,'study & blocked full details expand/collapse, non-buy flags, no horizontal overflow')
        ctx.close()
    browser.close()
