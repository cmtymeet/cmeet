import {test, expect} from '@playwright/test';

test('community garden limits role choices and requests a member-chosen handle', async ({page}) => {
  await page.goto('/#/admin');
  await page.getByRole('button',{name:'Sign in as admin',exact:true}).click();
  await expect(page.getByLabel('Role',{exact:true})).toBeVisible();
  await expect(page.locator('#member-role option[value="root"]')).toHaveCount(0);
  await page.getByLabel('Member ID',{exact:true}).fill('fixture-member');
  await page.getByLabel('Role',{exact:true}).selectOption('admin');
  await page.getByRole('button',{name:'Set role',exact:true}).click();
  await expect(page.getByText('Role updated.',{exact:true})).toBeVisible();
  await page.getByLabel('Reason for the member').fill('Please choose a different handle.');
  await page.getByRole('button',{name:'Require handle change'}).click();
  await expect(page.getByText('Change requested.',{exact:false})).toBeVisible();
  await expect(page.getByText('The member chooses within 7 days.',{exact:false})).toBeVisible();
});

test('root board admission opens the existing lobby, not the platform garden',async({page})=>{
  await page.goto('/?dev-scope=root#/board');
  await expect(page.getByRole('heading',{name:'Admin board',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Enter the board'}).click();
  await expect(page.getByRole('heading',{name:'Lobby',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Profile',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sign in as root'})).toHaveCount(0);
});
