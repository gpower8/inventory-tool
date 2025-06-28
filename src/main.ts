import MenuItem from './models/menu-item';
import InventoryItem from './models/inventory-item';
import { OrderService } from './services/order-service';
import { InventoryService } from './services/inventory-service';
import { logError, getSimpleErrorMessage } from './services/error-handler';
import { select, confirm } from '@inquirer/prompts';
import * as readline from 'readline';

// Simple readline interface for basic input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function displayCurrentInventory() {
  try {
    console.log('\nCurrent Inventory:');
    const inventory = await InventoryItem.findAll();
    
    if (inventory.length === 0) {
      console.log('  No inventory items found.');
      return;
    }
    
    inventory.forEach(item => {
      const stockStatus = item.isOutOfStock() ? ' (OUT OF STOCK)' : 
                         item.isLowStock(50000) ? ' (LOW STOCK)' : '';
      console.log(`  ${item.name}: ${item.getFormattedQuantity()}${stockStatus}`);
    });
    console.log('');
  } catch (error) {
    logError('Failed to display inventory', error);
    console.error(`\nError: ${getSimpleErrorMessage(error)}`);
  }
}

async function askOrder() {
  try {
    const menuItems = await MenuItem.findAll();
    
    if (menuItems.length === 0) {
      console.log('\n❌ No menu items available.');
      return null;
    }

    const choices = menuItems.map(mi => ({ name: mi.name, value: mi.id }));

    // Simple extra options
    choices.push({ name: 'View Current Inventory', value: -1 });
    choices.push({ name: 'Exit', value: -2 });

    const answer = await select({ message: 'Please select an item', choices });

    if (answer === -1) {
      await displayCurrentInventory();
      return await askOrder();
    }

    if (answer === -2) {
      return null;
    }

    return menuItems.find(mi => answer === mi.id);

  } catch (error) {
    console.error('Error in askOrder:', error);
    return null;
  }
}

async function processOrder(menuItem: any) {
  try {
    console.log(`\nProcessing order for ${menuItem.name}...`);
    
    // Step 1: Check inventory availability
    console.log('Checking ingredient availability...');
    const availabilityCheck = await InventoryService.checkOrderAvailability(menuItem.id);
    
    // Handle errors from availability check
    if (availabilityCheck.error) {
              console.error(`\nError: ${getSimpleErrorMessage(availabilityCheck.error)}`);
      return false;
    }
    
    if (!availabilityCheck.canFulfillOrder) {
      // Show out of stock message
      console.error(`\nError: ${availabilityCheck.errorMessage}`);
      
      if (availabilityCheck.unavailableIngredients.length > 0) {
        console.log('\nIngredient Status:');
        availabilityCheck.ingredientChecks.forEach(ingredient => {
          const status = ingredient.isAvailable ? 'Available' : 'Unavailable';
          const shortage = ingredient.isAvailable ? '' : ` (short by ${ingredient.shortfall}${ingredient.quantityUnit})`;
          console.log(`  - ${ingredient.ingredientName}: ${status}${shortage}`);
        });
      }
      return false;
    }

    // Step 2: Show detailed order confirmation
    console.log('\nAll ingredients are available.');
    console.log(`\nOrder Confirmation for ${menuItem.name}`);
    console.log('-'.repeat(40));
    
    console.log('\nItem Details:');
    console.log(`  Name: ${menuItem.name}`);
    console.log(`  Ingredients needed:`);
    
    // Show ingredient details
    availabilityCheck.ingredientChecks.forEach(ingredient => {
      const remaining = ingredient.availableQuantity - ingredient.requiredQuantity;
      const percentageUsed = ((ingredient.requiredQuantity / ingredient.availableQuantity) * 100).toFixed(1);
      console.log(`  - ${ingredient.ingredientName}:`);
      console.log(`    - Will use: ${ingredient.requiredQuantity}${ingredient.quantityUnit}`);
      console.log(`    - Will remain: ${remaining}${ingredient.quantityUnit}`);
      console.log(`    - Usage: ${percentageUsed}% of available stock`);
    });

    console.log('\n' + '-'.repeat(40));
    const shouldProceed = await confirm({ 
      message: `Confirm order for ${menuItem.name}?`,
      default: true
    });

    if (!shouldProceed) {
      console.log('\nOrder cancelled.');
      return false;
    }

    // Step 3: Process the order (deduct inventory)
    console.log('\nProcessing order and updating inventory...');
    const orderResult = await OrderService.processOrder(menuItem.id);

    if (!orderResult.success) {
      if (orderResult.error) {
        console.error(`\nError: ${orderResult.message}`);
        
        // Simple retry prompt for failed orders
        console.log('\nWould you like to try again? (y/n)');
        const retryChoice = await askQuestion('');
        if (retryChoice.toLowerCase() === 'y' || retryChoice.toLowerCase() === 'yes') {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Simple 1s delay
          return await processOrder(menuItem);
        }
      } else {
        console.log(`\nOrder failed: ${orderResult.message}`);
      }
      return false;
    }

    // Step 4: Show success message and what was deducted
    console.log(`\n${orderResult.message}`);
    console.log('\nIngredients used:');
    orderResult.orderDetails?.ingredientsUsed?.forEach(ingredient => {
      console.log(`  - ${ingredient.quantityUsed}${ingredient.quantityUnit} of ${ingredient.ingredientName} (${ingredient.remainingQuantity}${ingredient.quantityUnit} remaining)`);
    });

    return true;
  } catch (error) {
    logError('Order processing error', error);
    console.error(`\nError: ${getSimpleErrorMessage(error)}`);
    
    // Simple retry for general errors
    console.log('\nWould you like to try again? (y/n)');
    const retryChoice = await askQuestion('');
    if (retryChoice.toLowerCase() === 'y' || retryChoice.toLowerCase() === 'yes') {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simple 1s delay
      return await processOrder(menuItem);
    }
    
    return false;
  }
}

async function showOrderCapacity() {
  try {
    console.log('\nCurrent Order Capacity:');
    const capacity = await OrderService.getOrderCapacity();
    
    if (capacity.menuItems.length === 0) {
      console.log('  No menu items available.');
      return;
    }
    
    capacity.menuItems.forEach(item => {
      const limitText = item.limitingIngredient ? ` (limited by ${item.limitingIngredient})` : '';
      console.log(`  - ${item.menuItemName}: ${item.maxOrdersPossible} orders possible${limitText}`);
    });
    
    // Show overall stats
    const stats = capacity.overallStats;
    console.log(`\nSummary: ${stats.availableItems}/${stats.totalMenuItems} items available.`);
    console.log('');
  } catch (error) {
    logError('Failed to show order capacity', error);
    console.error(`\nError: ${getSimpleErrorMessage(error)}`);
  }
}

async function main() {
  console.log('Welcome to Cafe OS');
  
  // Show initial inventory and capacity
  await displayCurrentInventory();
  await showOrderCapacity();

  while (true) {
    try {
      const menuItem = await askOrder();
      
      if (!menuItem) {
        console.log('\nExiting. Thank you!');
        break;
      }

      const orderSuccess = await processOrder(menuItem);
      
      if (orderSuccess) {
        // Show updated inventory after successful order
        console.log('\nUpdated Inventory:');
        const updatedInventory = await InventoryItem.findAll();
        updatedInventory.forEach(item => {
          console.log(`  ${item.name}: ${item.getFormattedQuantity()}`);
        });
        
        // Show updated capacity
        await showOrderCapacity();
      }

      // Ask if they want to order something else
      const orderAgain = await confirm({ 
        message: 'Would you like to order something else?',
        default: true
      });

      if (!orderAgain) {
        console.log('\nExiting. Thank you!');
        break;
      }
      
      console.log('\n' + '-'.repeat(40) + '\n');
      
    } catch (error) {
      logError('Main menu error', error);
      console.error(`\nError: ${getSimpleErrorMessage(error)}`);
      
      const tryAgain = await confirm({ 
        message: 'An error occurred. Would you like to try again?',
        default: true
      });
      
      if (!tryAgain) {
        console.log('\nExiting. Thank you!');
        break;
      }
    }
  }
}

main().catch((error) => {
  logError('Application startup error', error);
  console.error(`\nFatal application error: ${getSimpleErrorMessage(error)}`);
  process.exit(1);
});
