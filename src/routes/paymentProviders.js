const express=require('express');
const {pool}=require('../db/pool');
const {createBookingPaymentService}=require('../services/bookingPayments');
function createPaymentProviderRouter({service=createBookingPaymentService({db:pool})}={}){const router=express.Router();router.post('/ozow/notify',express.urlencoded({extended:false,limit:'64kb'}),async(req,res,next)=>{try{const result=await service.handleOzowNotification(req.body||{});return res.status(200).type('text/plain').send(result.status==='duplicate'?'duplicate':'accepted');}catch(error){if(Number(error?.httpStatus)===400)return res.status(400).type('text/plain').send('rejected');return next(error);}});return router;}
module.exports={createPaymentProviderRouter};
