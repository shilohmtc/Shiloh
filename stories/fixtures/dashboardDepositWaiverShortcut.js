const {dashboardDepositsModel}=require('./workspaceDashboardDeposits');
const {waiverFixture}=require('./bookingDepositWaiverPresentation');
const {desktopNavigation}=require('./workspaceDesktopLayout');
const {renderDashboardPage,dashboardClientScript,planningRequestClientScript,depositQueueClientScript}=require('../../src/presentation/workspaceDashboardUx');
const {workspaceIconClientScript}=require('../../src/presentation/workspaceIconClient');
function shortcutPaymentModel(appointmentId=7201){const model=waiverFixture({shared:appointmentId===7202});model.subject.appointmentId=appointmentId;model.subject.clientName='Synthetic Aloe';model.deposit.scope.members=model.deposit.scope.members.map((member,index)=>({...member,appointmentId:appointmentId+index}));return model;}
function shortcutModel(kind='sparse',allowed=true){const model=dashboardDepositsModel(kind);model.depositQueue.items=model.depositQueue.items.map(item=>{const payment=shortcutPaymentModel(item.appointmentId);return {...item,state:'partial',outstanding:String(Number(payment.deposit.requirement.required_amount)-Number(payment.deposit.requirement.net_paid)),canWaiveDeposit:allowed,members:item.members.map((member,index)=>({...member,clientName:payment.deposit.scope.members[index].clientName,serviceName:payment.deposit.scope.members[index].serviceName}))};});return model;}
function shortcutHtml(kind='sparse',allowed=true,render=renderDashboardPage){return render(shortcutModel(kind,allowed),{navigation:desktopNavigation}).replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g,'').replace('</body>',`<script>${workspaceIconClientScript()}${dashboardClientScript()}${planningRequestClientScript()}${depositQueueClientScript()}</script></body>`);}
module.exports={shortcutModel,shortcutHtml,shortcutPaymentModel};
